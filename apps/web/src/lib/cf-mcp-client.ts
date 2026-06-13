import { randomUUID } from 'node:crypto';
import { checkAndConvertCurrency } from './fx-check';

export interface CfMcpClient {
  validate(jobId: string, payload: { invoice_lines: unknown[]; evidence_index: unknown[]; rule_version?: string }): Promise<{
    sct_trace_id: string;
    cf_mcp_tool_calls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }>;
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
  }>;
}

export class McpUnavailableError extends Error {
  readonly code = 'MCP_UNAVAILABLE';
  constructor(msg: string) { super(msg); this.name = 'McpUnavailableError'; }
}

// --- Boundary normalization (P0-3) ----------------------------------------
// The web client and the MCP validation server were authored against drifting
// contracts (e.g. check_cost_guard returns `line_findings`/`lineNo` while the
// client expected `lineResults`/`lineId`). Calling `.map` on the wrong key
// throws "Cannot read properties of undefined (reading 'map')" and surfaces as
// VALIDATION_FAILED. These helpers tolerate every known variant and never throw
// on missing/renamed keys, so an unknown shape degrades to [] instead of a 500.
type CostguardNorm = { line_id: string; band: 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL'; verdict: string; delta_pct: number | null; proofRef: string | null };

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Derive a COST-GUARD band when the tool omits an explicit `band`. */
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

/**
 * Normalize check_cost_guard output across server variants:
 * - apps/mcp-server: { line_findings: [{ lineNo, variance_pct, reason_code }] }
 * - legacy contract:  { lineResults:  [{ lineId, band, deltaPct, proofRef }] }
 */
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
// --------------------------------------------------------------------------

export function createCfMcpClient(opts: { baseUrl: string; timeoutMs: number; retries: number; backoffMs?: number }): CfMcpClient {
  const { baseUrl, timeoutMs, retries, backoffMs = 1000 } = opts;
  const url = `${baseUrl.replace(/\/$/, '')}/mcp`;

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<{ result: T; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const start = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
          signal: controller.signal
        });
        const latency_ms = Date.now() - start;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { result?: { tool?: string; status?: string; result?: T } | T; error?: { message: string } };
        if (json.error) throw new Error(json.error.message);
        clearTimeout(timer);
        const payload = ((json.result as any)?.result ?? json.result) as T;
        return { result: payload, latency_ms, status: 'OK' };
      } catch (e) {
        lastErr = e;
        const latency_ms = Date.now() - start;
        const isTimeout = (e as Error).name === 'AbortError';
        clearTimeout(timer);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          continue;
        }
        if (isTimeout) throw new McpUnavailableError(`MCP_UNAVAILABLE: tool ${name} timeout after ${retries + 1} attempts`);
        throw new McpUnavailableError(`MCP_UNAVAILABLE: tool ${name} unavailable: ${(e as Error).message}`);
      }
    }
    throw new McpUnavailableError(`MCP_UNAVAILABLE: tool ${name} exhausted retries: ${String(lastErr)}`);
  }

  return {
    async validate(jobId, payload) {
      const sct_trace_id = `sct_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const toolCalls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> = [];

      const processedLines = [];
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
          processedLines.push({
            ...line,
            amount: checkRes.converted_amount,
            rate: line.rate ? line.rate * (checkRes.fx_rate || 1) : line.rate,
            currency: rateCurrency
          });
        } else {
          processedLines.push(line);
        }
      }

      const route = await callTool<{ domain: string; requiredCorpus: string[] }>('route_question', { question: `audit:${jobId}`, userRole: 'ops_user' });
      toolCalls.push({ tool: 'route_question', latency_ms: route.latency_ms, status: route.status });

      const type_b_results: Array<{ line_id: string; type_b: string; confidence: number }> = [];

      let batchClassifications: Array<{ line_id: string; type_b: string; sct_code: string; confidence: number }> = [];
      try {
        const classifyLines = processedLines.map((l: any) => ({ line_id: l.line_id, description: l.description }));
        const typeB = await callTool<{ classifications: Array<{ line_id: string; type_b: string; sct_code: string; confidence: number }> }>('classify_type_b', { lines: classifyLines });
        toolCalls.push({ tool: 'classify_type_b', latency_ms: typeB.latency_ms, status: typeB.status });
        batchClassifications = typeB.result?.classifications ?? [];
      } catch {
        toolCalls.push({ tool: 'classify_type_b', latency_ms: 0, status: 'ERROR' });
      }

      // C-02: dryrun_rate_lookup — one call per line, failures fall back gracefully
      const rate_checks: Array<{ line_id: string; rate_status: string; validity_status: 'VALID'|'EXPIRED'|'PENDING'|null }> = [];
      for (const line of processedLines as any[]) {
        const classEntry = batchClassifications.find(c => c.line_id === line.line_id);
        const charge = line.description ?? classEntry?.type_b ?? '';
        const unit = line.unit ?? 'per shipment';
        try {
          const rateRes = await callTool<{ contracted_rate: number | null; verdict: string; reason_code: string | null }>('check_rate_card', { charge_code: charge, lane: line.lane ?? null, rate_basis: unit, effective_date: null, applied_rate: line.rate ?? null });
          toolCalls.push({ tool: 'check_rate_card', latency_ms: rateRes.latency_ms, status: rateRes.status });
          rate_checks.push({
            line_id: line.line_id,
            rate_status: rateRes.result.verdict,
            validity_status: null
          });
        } catch {
          rate_checks.push({
            line_id: line.line_id,
            rate_status: 'UNKNOWN',
            validity_status: null
          });
        }
      }

      const costguard = await callTool<{ lineResults: Array<{ lineId: string; band: 'PASS'|'WARN'|'HIGH'|'CRITICAL'; deltaPct: number | null; verdict: string; proofRef: string | null }> }>('check_cost_guard', {
        invoiceNo: jobId,
        currency: processedLines[0]?.currency ?? 'AED',
        lines: processedLines.map((l: any) => ({
          lineNo: l.line_id,
          item: l.description,
          qty: l.qty ?? 1,
          rate: l.rate ?? l.amount,
          draftAmount: l.amount,
          standardAmount: l.standard_amount ?? null,
          currency: l.currency,
          evidenceIds: []
        }))
      });
      toolCalls.push({ tool: 'check_cost_guard', latency_ms: costguard.latency_ms, status: costguard.status });

      for (const line of processedLines as any[]) {
        try {
          const ctb = await callTool<{ type_b: string; confidence: number }>('classify_type_b', { line_id: line.line_id, description: line.description });
          toolCalls.push({ tool: 'classify_type_b', latency_ms: ctb.latency_ms, status: ctb.status });
          const idx = type_b_results.findIndex(t => t.line_id === line.line_id);
          if (idx >= 0) {
            type_b_results[idx] = { line_id: line.line_id, type_b: ctb.result.type_b, confidence: ctb.result.confidence };
          } else {
            type_b_results.push({ line_id: line.line_id, type_b: ctb.result.type_b, confidence: ctb.result.confidence });
          }
        } catch {
          toolCalls.push({ tool: 'classify_type_b', latency_ms: 0, status: 'ERROR' });
        }
      }

      const evidenceDocs = (payload.evidence_index as any[] | undefined) ?? [];
      const hs_uae_results: Array<{ line_id: string; verdict: 'PASS' | 'AMBER' | 'ZERO'; boe_found: boolean; reason_code: string | null }> = [];
      for (const line of processedLines as any[]) {
        if (line.charge_code === 'CUSTOMS') {
          try {
            const hs = await callTool<{ verdict: 'PASS' | 'AMBER' | 'ZERO'; boe_found: boolean; reason_code: string | null }>('check_hs_uae_compliance', { line_id: line.line_id, evidence_docs: evidenceDocs });
            toolCalls.push({ tool: 'check_hs_uae_compliance', latency_ms: hs.latency_ms, status: hs.status });
            hs_uae_results.push({ line_id: line.line_id, verdict: hs.result.verdict, boe_found: hs.result.boe_found, reason_code: hs.result.reason_code });
          } catch {
            toolCalls.push({ tool: 'check_hs_uae_compliance', latency_ms: 0, status: 'ERROR' });
            hs_uae_results.push({ line_id: line.line_id, verdict: 'AMBER', boe_found: false, reason_code: 'HS_UAE_TOOL_UNAVAILABLE' });
          }
        }
      }

      type DocGuardianResult = { result: { findings: Array<{ lineId: string | null; code: string; severity: 'AMBER' | 'ZERO' }> }; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' };
      let docResult: DocGuardianResult | null = null;
      try {
        docResult = await callTool<{ findings: Array<{ lineId: string | null; code: string; severity: 'AMBER' | 'ZERO' }> }>('check_evidence_required', { invoice_lines: processedLines.map((l: any) => ({ line_id: l.line_id, description: l.description })), evidence_index: payload.evidence_index ?? [] });
        toolCalls.push({ tool: 'check_evidence_required', latency_ms: docResult.latency_ms, status: docResult.status });
      } catch {
        toolCalls.push({ tool: 'check_evidence_required', latency_ms: 0, status: 'ERROR' });
        docResult = { result: { findings: [{ lineId: null, code: 'EVIDENCE_TOOL_UNAVAILABLE', severity: 'AMBER' }] }, latency_ms: 0, status: 'ERROR' };
      }

      // C-02: ontology_evidence_map — called once with all distinct SCT codes from type_b results
      const evidence_requirements: Array<{ line_id: string; required_evidence: string[] }> = [];
      const distinctSctCodes = [...new Set(
        batchClassifications
          .map(c => c.sct_code)
          .filter((code): code is string => Boolean(code))
      )];

      if (distinctSctCodes.length > 0) {
        // P0-3: guard like the docResult call above — an unavailable evidence tool
        // must degrade gracefully, not abort the whole validation.
        try {
          const evidenceMap = await callTool<{ evidence_requirements: Array<{ line_id: string; required_evidence: string[] }> }>('check_evidence_required', { invoice_lines: processedLines.map((l: any) => ({ line_id: l.line_id, description: l.description })), evidence_index: payload.evidence_index ?? [] });
          toolCalls.push({ tool: 'check_evidence_required', latency_ms: evidenceMap.latency_ms, status: evidenceMap.status });

          for (const evReq of asArray<{ line_id: string; required_evidence: string[] }>(evidenceMap.result?.evidence_requirements)) {
            evidence_requirements.push({
              line_id: evReq.line_id,
              required_evidence: asArray<string>(evReq.required_evidence)
            });
          }
        } catch {
          toolCalls.push({ tool: 'check_evidence_required', latency_ms: 0, status: 'ERROR' });
        }
      }

      const costguard_results = normCostguard(costguard.result).map(lr => ({
        line_id: lr.line_id,
        band: lr.band,
        verdict: lr.verdict,
        delta_pct: lr.delta_pct,
        prism_kernel_proof_ref: lr.proofRef,
        fx_policy_id: activeFxPolicyId
      }));

      const gate_results = costguard_results.map(cr => ({
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
        doc_guardian_results: asArray<any>(docResult?.result?.findings).map(f => ({
          line_id: f?.lineId ?? f?.line_id ?? null,
          code: f?.code ?? 'EVIDENCE_FINDING',
          severity: (f?.severity ?? 'AMBER') as 'AMBER' | 'ZERO'
        })),
        gate_results,
        confidence: 0.95,
        reason_codes: [],
        warnings: []
      };
    }
  };
}
