import { randomUUID, createHash } from 'node:crypto';
import { checkAndConvertCurrency } from './fx-check';
import { dispatch } from './mcp/tools';

export interface CfMcpClient {
  validate(jobId: string, payload: { invoice_lines: unknown[]; evidence_index: unknown[]; rule_version?: string }): Promise<{
    sct_trace_id: string;
    cf_mcp_tool_calls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' | 'SKIPPED' }>;
    type_b_results: Array<{ line_id: string; type_b: string; confidence: number }>;
    hs_uae_results: Array<{ line_id: string; verdict: 'PASS' | 'AMBER' | 'ZERO'; boe_found: boolean; reason_code: string | null }>;
    rate_checks: Array<{ line_id: string; rate_status: string; validity_status: 'VALID'|'EXPIRED'|'PENDING'|null }>;
    evidence_requirements: Array<{ line_id: string; required_evidence: string[] }>;
    costguard_results: Array<{ line_id: string; band: 'PASS'|'WARN'|'HIGH'|'CRITICAL'; verdict: string; delta_pct: number | null; prism_kernel_proof_ref: string | null; fx_policy_id?: string | null }>;
    doc_guardian_results: Array<{ line_id: string | null; code: string; severity: 'AMBER'|'ZERO' }>;
    gate_results: Array<{ line_id: string | null; gate_status: 'PASS'|'AMBER'|'ZERO'|'FAILED'; reason_codes: string[] }>;
    confidence: number;
    reason_codes: string[];
    warnings: string[];
    normalized_lines: Array<{ line_id: string; charge_code: string | null; unit: string | null }>;
    duplicate_checks: Array<{ vendor_hash: string; invoice_no_hash: string; verdict: string; reason_code: string | null; duplicate_count: number; amount_hash: string | null; issue_date_hash: string | null; matched_job_id: string | null }>;
    shipment_matches: Array<{ line_id: string; verdict: string; match_count: number; matches: Array<{ shipment_ref: string; confidence: number; matched_via: string }> }>;
    contract_validity_results: Array<{ vendor_hash: string; vendor_name: string; verdict: string; contract_id: string | null; reason_code: string | null }>;
    tax_vat_results: Array<{ line_id: string; verdict: string; expected_vat: number | null; applied_vat: number | null; reason_code: string | null }>;
    fx_policy_results: Array<{ from_currency: string; to_currency: string; verdict: string; reason_code: string | null }>;
    dem_det_results: Array<{ line_id: string; charge_code: string; verdict: string; missing_inputs: string[]; reason_code: string | null }>;
    validation_explanations: Array<{ finding_id: string; rule_id: string; reason_code: string; line_id: string | null; severity: string; explanation: string; recommended_action: string }>;
  }>;
}

/** Retained for API compatibility — in-process tools never raise it, but run/route imports it. */
export class McpUnavailableError extends Error {
  readonly code = 'MCP_UNAVAILABLE';
  constructor(msg: string) { super(msg); this.name = 'McpUnavailableError'; }
}

// --- Boundary normalization -----------------------------------------------
// check_cost_guard returns `line_findings`/`lineNo`; older callers expected
// `lineResults`/`lineId`. normCostguard tolerates both so the band/verdict
// mapping never throws on a renamed key.
type CostguardNorm = { line_id: string; band: 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL'; verdict: string; delta_pct: number | null; proofRef: string | null };

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function deriveBand(lr: any): 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL' {
  if (lr?.band) return lr.band;
  const v = String(lr?.verdict ?? '').toUpperCase();
  if (v === 'ZERO') return 'CRITICAL';
  if (v === 'AMBER' || v === 'WARN') return 'WARN';
  if (v === 'PASS') return 'PASS';
  const rc = lr?.reason_code ?? lr?.reasonCode ?? null;
  if (rc === 'QTY_X_RATE_MISMATCH') return 'CRITICAL';
  if (rc) return 'WARN';
  const d = lr?.deltaPct ?? lr?.variance_pct ?? lr?.delta_pct ?? null;
  if (typeof d === 'number' && Math.abs(d) > 2) return 'WARN';
  return 'PASS';
}

function normCostguard(raw: any): CostguardNorm[] {
  const arr = asArray<any>(raw?.lineResults ?? raw?.line_findings ?? raw?.lines);
  return arr.map((lr) => ({
    line_id: String(lr?.lineId ?? lr?.lineNo ?? lr?.line_id ?? ''),
    band: deriveBand(lr),
    verdict: String(lr?.verdict ?? lr?.gate_status ?? 'PASS'),
    delta_pct: lr?.deltaPct ?? lr?.variance_pct ?? lr?.delta_pct ?? null,
    proofRef: lr?.proofRef ?? lr?.prism_kernel_proof_ref ?? null
  }));
}

/** Map an evidence_index entry to a string token for BOE/evidence pattern checks. */
function evidenceToken(e: any): string {
  return String(e?.type ?? e?.doc_type ?? e?.evidence_type ?? e?.text ?? e ?? '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashNullable(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return sha256(String(value));
}

// --------------------------------------------------------------------------

export function createCfMcpClient(_opts?: { baseUrl?: string; timeoutMs?: number; retries?: number; backoffMs?: number }): CfMcpClient {
  /** In-process tool call: zod-validate + run via dispatch, wrapped in the legacy {result,latency_ms,status} envelope. */
  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<{ result: T; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> {
    const start = Date.now();
    const result = await dispatch<T>(name, args);
    return { result, latency_ms: Date.now() - start, status: 'OK' };
  }

  return {
    async validate(jobId, payload) {
      const sct_trace_id = `sct_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const toolCalls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' | 'SKIPPED' }> = [];

      // FX normalization (unchanged): convert line amounts to the contract currency.
      const processedLines: any[] = [];
      let activeFxPolicyId: string | null = null;
      for (const line of (payload.invoice_lines as any[])) {
        const lineCurrency = line.currency;
        const rateCurrency = line.rate_ref_currency || line.contract_currency;
        if (rateCurrency && lineCurrency !== rateCurrency) {
          const checkRes = await checkAndConvertCurrency(lineCurrency, rateCurrency, line.amount, line.rate_date);
          if (!checkRes.allowed) {
            const err = new Error(checkRes.error_message);
            (err as any).code = checkRes.error_code;
            throw err;
          }
          activeFxPolicyId = checkRes.fx_policy_id || null;
          processedLines.push({ ...line, amount: checkRes.converted_amount, rate: line.rate ? line.rate * (checkRes.fx_rate || 1) : line.rate, currency: rateCurrency });
        } else {
          processedLines.push(line);
        }
      }

      // Step 0: normalize_invoice_lines — raw lines → standard charge codes
      const normalizedLinesOut: Array<{ line_id: string; charge_code: string | null; unit: string | null }> = [];
      const normalizedByLineId = new Map<string, { charge_code: string | null; unit: string | null }>();
      try {
        const normResult = await callTool<{ normalized_lines: Array<{ line_id: string; charge_code: string | null; unit: string | null; qty: number | null; rate: number | null; amount: number; currency: string }>; rejected_count: number }>('normalize_invoice_lines', {
          lines: processedLines.map((l) => ({
            line_id: l.line_id,
            description: l.description ?? '',
            qty: (l.qty != null) ? l.qty : null,
            rate: (l.rate != null) ? l.rate : null,
            amount: l.amount,
            currency: l.currency ?? 'AED'
          }))
        });
        toolCalls.push({ tool: 'normalize_invoice_lines', latency_ms: normResult.latency_ms, status: normResult.status });
        for (const nl of normResult.result.normalized_lines ?? []) {
          normalizedLinesOut.push({ line_id: nl.line_id, charge_code: nl.charge_code, unit: nl.unit });
          normalizedByLineId.set(nl.line_id, { charge_code: nl.charge_code, unit: nl.unit });
        }
        for (const line of processedLines) {
          const nl = normalizedByLineId.get(line.line_id);
          if (nl) {
            if (!line.charge_code) line.charge_code = nl.charge_code;
            if (!line.unit) line.unit = nl.unit;
          }
        }
      } catch {
        toolCalls.push({ tool: 'normalize_invoice_lines', latency_ms: 0, status: 'ERROR' });
      }

      // Step 1: route_question
      const route = await callTool('route_question', { question: `audit:${jobId}`, userRole: 'ops_user' });
      toolCalls.push({ tool: 'route_question', latency_ms: route.latency_ms, status: route.status });

      // Step 2: classify_type_b — per-line
      const type_b_results: Array<{ line_id: string; type_b: string; confidence: number }> = [];
      const typeBByLine = new Map<string, string>();
      for (const line of processedLines) {
        try {
          const ctb = await callTool<{ type_b: string; confidence: number }>('classify_type_b', { line_id: line.line_id, description: line.description ?? '' });
          toolCalls.push({ tool: 'classify_type_b', latency_ms: ctb.latency_ms, status: ctb.status });
          type_b_results.push({ line_id: line.line_id, type_b: ctb.result.type_b, confidence: ctb.result.confidence });
          typeBByLine.set(line.line_id, ctb.result.type_b);
        } catch {
          toolCalls.push({ tool: 'classify_type_b', latency_ms: 0, status: 'ERROR' });
        }
      }

      const chargeCodeOf = (line: any): string => line.charge_code ?? typeBByLine.get(line.line_id) ?? 'GENERAL';

      // Step 3: check_rate_card — per-line
      const rate_checks: Array<{ line_id: string; rate_status: string; validity_status: 'VALID'|'EXPIRED'|'PENDING'|null }> = [];
      for (const line of processedLines) {
        try {
          const rateRes = await callTool<{ verdict: string; reason_code: string | null }>('check_rate_card', { charge_code: chargeCodeOf(line), lane: line.lane ?? null, rate_basis: line.unit ?? null, effective_date: null, applied_rate: line.rate ?? null });
          toolCalls.push({ tool: 'check_rate_card', latency_ms: rateRes.latency_ms, status: rateRes.status });
          rate_checks.push({ line_id: line.line_id, rate_status: rateRes.result.verdict, validity_status: null });
        } catch {
          toolCalls.push({ tool: 'check_rate_card', latency_ms: 0, status: 'ERROR' });
          rate_checks.push({ line_id: line.line_id, rate_status: 'UNKNOWN', validity_status: null });
        }
      }

      // Step 4: check_cost_guard — one batch call
      let costguardRaw: any = { line_findings: [] };
      try {
        const costguard = await callTool('check_cost_guard', {
          invoiceNo: jobId,
          currency: processedLines[0]?.currency ?? 'AED',
          lines: processedLines.map((l) => ({
            lineNo: l.line_id,
            item: l.description ?? '',
            qty: l.qty ?? 1,
            rate: l.rate ?? l.amount,
            draftAmount: l.amount,
            standardAmount: l.standard_amount ?? null,
            currency: l.currency ?? 'AED',
            evidenceIds: []
          }))
        });
        toolCalls.push({ tool: 'check_cost_guard', latency_ms: costguard.latency_ms, status: costguard.status });
        costguardRaw = costguard.result;
      } catch {
        toolCalls.push({ tool: 'check_cost_guard', latency_ms: 0, status: 'ERROR' });
      }

      const evidenceDocs = asArray<any>(payload.evidence_index).map(evidenceToken).filter(Boolean);

      // Step 5: check_evidence_required — per-line
      const evidence_requirements: Array<{ line_id: string; required_evidence: string[] }> = [];
      const doc_guardian_results: Array<{ line_id: string | null; code: string; severity: 'AMBER' | 'ZERO' }> = [];
      for (const line of processedLines) {
        try {
          const ev = await callTool<{ verdict: 'PASS'|'AMBER'|'ZERO'; required_evidence: string[]; missing_evidence: string[] }>('check_evidence_required', { line_id: line.line_id, charge_code: chargeCodeOf(line), sct_code: line.sct_code ?? null, present_evidence: evidenceDocs });
          toolCalls.push({ tool: 'check_evidence_required', latency_ms: ev.latency_ms, status: ev.status });
          evidence_requirements.push({ line_id: line.line_id, required_evidence: asArray<string>(ev.result.required_evidence) });
          if (ev.result.verdict !== 'PASS') {
            doc_guardian_results.push({ line_id: line.line_id, code: `EVIDENCE_MISSING_${asArray<string>(ev.result.missing_evidence).join('_') || 'REQUIRED'}`, severity: ev.result.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
          }
        } catch {
          toolCalls.push({ tool: 'check_evidence_required', latency_ms: 0, status: 'ERROR' });
        }
      }

      // Step 6: check_hs_uae_compliance — only CUSTOMS lines
      const hs_uae_results: Array<{ line_id: string; verdict: 'PASS' | 'AMBER' | 'ZERO'; boe_found: boolean; reason_code: string | null }> = [];
      for (const line of processedLines) {
        if (chargeCodeOf(line) !== 'CUSTOMS') continue;
        try {
          const hs = await callTool<{ verdict: 'PASS'|'AMBER'|'ZERO'; boe_found: boolean; reason_code: string | null }>('check_hs_uae_compliance', { line_id: line.line_id, charge_code: 'CUSTOMS', hs_code: line.hs_code ?? null, evidence_docs: evidenceDocs });
          toolCalls.push({ tool: 'check_hs_uae_compliance', latency_ms: hs.latency_ms, status: hs.status });
          hs_uae_results.push({ line_id: line.line_id, verdict: hs.result.verdict, boe_found: hs.result.boe_found, reason_code: hs.result.reason_code });
        } catch {
          toolCalls.push({ tool: 'check_hs_uae_compliance', latency_ms: 0, status: 'ERROR' });
          hs_uae_results.push({ line_id: line.line_id, verdict: 'AMBER', boe_found: false, reason_code: 'HS_UAE_TOOL_UNAVAILABLE' });
        }
      }

      // Step 7: check_duplicate_invoice — per unique vendor+invoice_no
      const duplicate_checks: Array<{ vendor_hash: string; invoice_no_hash: string; verdict: string; reason_code: string | null; duplicate_count: number; amount_hash: string | null; issue_date_hash: string | null; matched_job_id: string | null }> = [];
      const seenVendorInvoice = new Set<string>();
      for (const line of processedLines) {
        const vendorName = line.vendor_name ?? line.vendor_id ?? null;
        const invoiceNo = line.invoice_no ?? null;
        if (!vendorName || !invoiceNo) continue;
        const key = `${vendorName}|${invoiceNo}`;
        if (seenVendorInvoice.has(key)) continue;
        seenVendorInvoice.add(key);

        try {
          const vendorHash = sha256(vendorName);
          const invoiceNoHash = sha256(invoiceNo);
          const dupResult = await callTool<{ verdict: string; duplicates: Array<{ amount?: number; issue_date?: string | null; job_id?: string }>; reason_code: string | null }>('check_duplicate_invoice', {
            vendor_hash: vendorHash,
            invoice_no_hash: invoiceNoHash,
            amount: line.amount,
            issue_date: line.issue_date ?? null
          });
          toolCalls.push({ tool: 'check_duplicate_invoice', latency_ms: dupResult.latency_ms, status: dupResult.status });
          duplicate_checks.push({
            vendor_hash: vendorHash,
            invoice_no_hash: invoiceNoHash,
            verdict: dupResult.result.verdict,
            reason_code: dupResult.result.reason_code,
            duplicate_count: (dupResult.result.duplicates ?? []).length,
            amount_hash: hashNullable(typeof line.amount === 'number' ? line.amount.toFixed(2) : line.amount),
            issue_date_hash: hashNullable(line.issue_date),
            matched_job_id: dupResult.result.duplicates?.[0]?.job_id ?? null
          });
        } catch {
          toolCalls.push({ tool: 'check_duplicate_invoice', latency_ms: 0, status: 'ERROR' });
        }
      }

      // Step 8: match_shipment_reference — per line (skip if no shipment refs on any line)
      const shipment_matches: Array<{ line_id: string; verdict: string; match_count: number; matches: Array<{ shipment_ref: string; confidence: number; matched_via: string }> }> = [];
      const hasAnyShipmentRef = processedLines.some((l) =>
        l.shipment_ref || l.job_number || l.bl_number || l.do_number
      );
      if (hasAnyShipmentRef) {
        for (const line of processedLines) {
          try {
            const smResult = await callTool<{ verdict: string; matches: Array<{ shipment_ref: string; confidence: number; matched_via: string }> }>('match_shipment_reference', {
              shipment_ref: line.shipment_ref ?? null,
              job_number: line.job_number ?? null,
              bl_number: line.bl_number ?? null,
              do_number: line.do_number ?? null
            });
            toolCalls.push({ tool: 'match_shipment_reference', latency_ms: smResult.latency_ms, status: smResult.status });
            shipment_matches.push({
              line_id: line.line_id,
              verdict: smResult.result.verdict,
              match_count: (smResult.result.matches ?? []).length,
              matches: smResult.result.matches ?? []
            });
          } catch {
            toolCalls.push({ tool: 'match_shipment_reference', latency_ms: 0, status: 'ERROR' });
          }
        }
      } else {
        toolCalls.push({ tool: 'match_shipment_reference', latency_ms: 0, status: 'SKIPPED' });
      }

      // Step 9: check_contract_validity — per unique vendor
      const contract_validity_results: Array<{ vendor_hash: string; vendor_name: string; verdict: string; contract_id: string | null; reason_code: string | null }> = [];
      const seenVendors = new Set<string>();
      const checkDate = new Date().toISOString().slice(0, 10);
      const hasAnyVendor = processedLines.some((l) => l.vendor_name || l.vendor_id);
      if (hasAnyVendor) {
        for (const line of processedLines) {
          const vendorName = line.vendor_name ?? line.vendor_id ?? null;
          if (!vendorName) continue;
          if (seenVendors.has(vendorName)) continue;
          seenVendors.add(vendorName);

          try {
            const vendorHash = sha256(vendorName);
            const cvResult = await callTool<{ verdict: string; contract_id: string | null; valid_from: string | null; valid_to: string | null; reason_code: string | null }>('check_contract_validity', {
              vendor_hash: vendorHash,
              contract_id: line.contract_id ?? null,
              check_date: checkDate
            });
            toolCalls.push({ tool: 'check_contract_validity', latency_ms: cvResult.latency_ms, status: cvResult.status });
            contract_validity_results.push({
              vendor_hash: vendorHash,
              vendor_name: vendorName,
              verdict: cvResult.result.verdict,
              contract_id: cvResult.result.contract_id,
              reason_code: cvResult.result.reason_code
            });
          } catch {
            toolCalls.push({ tool: 'check_contract_validity', latency_ms: 0, status: 'ERROR' });
          }
        }
      } else {
        toolCalls.push({ tool: 'check_contract_validity', latency_ms: 0, status: 'SKIPPED' });
      }

      // Step 10: check_tax_vat — per line with amount/currency
      const tax_vat_results: Array<{ line_id: string; verdict: string; expected_vat: number | null; applied_vat: number | null; reason_code: string | null }> = [];
      for (const line of processedLines) {
        if (line.amount == null) continue;
        try {
          const tvResult = await callTool<{ verdict: string; expected_vat: number | null; applied_vat: number | null; reason_code: string | null }>('check_tax_vat', {
            line_id: line.line_id,
            amount: line.amount,
            currency: line.currency ?? 'AED',
            vat_rate: line.vat_rate ?? null
          });
          toolCalls.push({ tool: 'check_tax_vat', latency_ms: tvResult.latency_ms, status: tvResult.status });
          tax_vat_results.push({
            line_id: line.line_id,
            verdict: tvResult.result.verdict,
            expected_vat: tvResult.result.expected_vat,
            applied_vat: tvResult.result.applied_vat,
            reason_code: tvResult.result.reason_code
          });
        } catch {
          toolCalls.push({ tool: 'check_tax_vat', latency_ms: 0, status: 'ERROR' });
        }
      }

      // Step 11: check_fx_policy — per unique currency pair (after FX normalization, lines share currency)
      const fx_policy_results: Array<{ from_currency: string; to_currency: string; verdict: string; reason_code: string | null }> = [];
      const seenCurrencyPairs = new Set<string>();
      for (const line of (payload.invoice_lines as any[])) {
        const fromCurrency = line.currency ?? 'AED';
        const toCurrency = line.rate_ref_currency || line.contract_currency;
        if (!toCurrency || fromCurrency === toCurrency) continue;
        const pairKey = `${fromCurrency}→${toCurrency}`;
        if (seenCurrencyPairs.has(pairKey)) continue;
        seenCurrencyPairs.add(pairKey);

        try {
          const fxResult = await callTool<{ verdict: string; applied_rate: number | null; policy_rate: number | null; variance_pct: number | null; reason_code: string | null }>('check_fx_policy', {
            from_currency: fromCurrency,
            to_currency: toCurrency,
            amount: line.amount,
            rate_date: line.rate_date ?? null
          });
          toolCalls.push({ tool: 'check_fx_policy', latency_ms: fxResult.latency_ms, status: fxResult.status });
          fx_policy_results.push({
            from_currency: fromCurrency,
            to_currency: toCurrency,
            verdict: fxResult.result.verdict,
            reason_code: fxResult.result.reason_code
          });
        } catch {
          toolCalls.push({ tool: 'check_fx_policy', latency_ms: 0, status: 'ERROR' });
        }
      }

      // Step 12: check_dem_det — only for DEMURRAGE/DETENTION/STORAGE lines
      const dem_det_results: Array<{ line_id: string; charge_code: string; verdict: string; missing_inputs: string[]; reason_code: string | null }> = [];
      const demDetCodes = ['DEMURRAGE', 'DETENTION', 'STORAGE'];
      for (const line of processedLines) {
        const cc = chargeCodeOf(line);
        if (!demDetCodes.includes(cc)) continue;
        try {
          const ddResult = await callTool<{ verdict: string; missing_inputs: string[]; reason_code: string | null }>('check_dem_det', {
            line_id: line.line_id,
            charge_code: cc,
            has_dates: !!(line.start_date && line.end_date),
            has_tariff: !!line.tariff_ref,
            has_free_time: line.free_time_days != null,
            has_invoice: true,
            is_final_settlement: line.is_final_settlement === true
          });
          toolCalls.push({ tool: 'check_dem_det', latency_ms: ddResult.latency_ms, status: ddResult.status });
          dem_det_results.push({
            line_id: line.line_id,
            charge_code: cc,
            verdict: ddResult.result.verdict,
            missing_inputs: ddResult.result.missing_inputs ?? [],
            reason_code: ddResult.result.reason_code
          });
        } catch {
          toolCalls.push({ tool: 'check_dem_det', latency_ms: 0, status: 'ERROR' });
        }
      }

      // Step 13: build_validation_explanation — once per finding, aggregate from all previous steps
      const validation_explanations: Array<{ finding_id: string; rule_id: string; reason_code: string; line_id: string | null; severity: string; explanation: string; recommended_action: string }> = [];
      type FindingEntry = { finding_id: string; rule_id: string; reason_code: string; line_id: string | null; severity: string };
      const allFindings: FindingEntry[] = [];

      for (const hs of hs_uae_results) {
        if (hs.verdict !== 'PASS' && hs.reason_code) {
          allFindings.push({ finding_id: `hs_${hs.line_id}`, rule_id: 'check_hs_uae_compliance', reason_code: hs.reason_code, line_id: hs.line_id, severity: hs.verdict });
        }
      }
      for (const dg of doc_guardian_results) {
        allFindings.push({ finding_id: `ev_${dg.line_id}`, rule_id: 'check_evidence_required', reason_code: dg.code, line_id: dg.line_id, severity: dg.severity });
      }
      for (const dup of duplicate_checks) {
        if (dup.reason_code) {
          allFindings.push({ finding_id: `dup_${dup.vendor_hash.slice(0, 8)}`, rule_id: 'check_duplicate_invoice', reason_code: dup.reason_code, line_id: null, severity: dup.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
        }
      }
      for (const cv of contract_validity_results) {
        if (cv.reason_code) {
          allFindings.push({ finding_id: `cv_${cv.vendor_hash.slice(0, 8)}`, rule_id: 'check_contract_validity', reason_code: cv.reason_code, line_id: null, severity: cv.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
        }
      }
      for (const tv of tax_vat_results) {
        if (tv.reason_code) {
          allFindings.push({ finding_id: `vat_${tv.line_id}`, rule_id: 'check_tax_vat', reason_code: tv.reason_code, line_id: tv.line_id, severity: tv.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
        }
      }
      for (const dd of dem_det_results) {
        if (dd.reason_code) {
          allFindings.push({ finding_id: `dd_${dd.line_id}`, rule_id: 'check_dem_det', reason_code: dd.reason_code, line_id: dd.line_id, severity: dd.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
        }
      }

      for (const f of allFindings) {
        try {
          const veResult = await callTool<{ explanation: string; recommended_action: string; reviewer_hint: string | null }>('build_validation_explanation', {
            finding_id: f.finding_id,
            rule_id: f.rule_id,
            reason_code: f.reason_code,
            line_id: f.line_id,
            severity: f.severity
          });
          toolCalls.push({ tool: 'build_validation_explanation', latency_ms: veResult.latency_ms, status: veResult.status });
          validation_explanations.push({
            finding_id: f.finding_id,
            rule_id: f.rule_id,
            reason_code: f.reason_code,
            line_id: f.line_id,
            severity: f.severity,
            explanation: veResult.result.explanation,
            recommended_action: veResult.result.recommended_action
          });
        } catch {
          toolCalls.push({ tool: 'build_validation_explanation', latency_ms: 0, status: 'ERROR' });
        }
      }

      const costguard_results = normCostguard(costguardRaw).map((lr) => ({
        line_id: lr.line_id,
        band: lr.band,
        verdict: lr.verdict,
        delta_pct: lr.delta_pct,
        prism_kernel_proof_ref: lr.proofRef,
        fx_policy_id: activeFxPolicyId
      }));

      const gate_results = costguard_results.map((cr) => ({
        line_id: cr.line_id,
        gate_status: cr.band === 'PASS' ? 'PASS' as const : cr.band === 'WARN' ? 'AMBER' as const : 'ZERO' as const,
        reason_codes: [`COSTGUARD_${cr.band}`]
      }));

      return {
        sct_trace_id,
        cf_mcp_tool_calls: toolCalls,
        type_b_results,
        hs_uae_results,
        rate_checks,
        evidence_requirements,
        costguard_results,
        doc_guardian_results,
        gate_results,
        confidence: 0.95,
        reason_codes: [],
        warnings: [],
        normalized_lines: normalizedLinesOut,
        duplicate_checks,
        shipment_matches,
        contract_validity_results,
        tax_vat_results,
        fx_policy_results,
        dem_det_results,
        validation_explanations
      };
    }
  };
}
