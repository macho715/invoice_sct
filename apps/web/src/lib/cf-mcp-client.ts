import { randomUUID } from 'node:crypto';
import { checkAndConvertCurrency } from './fx-check';
import { dispatch } from './mcp/tools';

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
      const toolCalls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> = [];

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

      const route = await callTool('route_question', { question: `audit:${jobId}`, userRole: 'ops_user' });
      toolCalls.push({ tool: 'route_question', latency_ms: route.latency_ms, status: route.status });

      // classify_type_b — per-line (server schema is single-line, not batch).
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

      // check_rate_card — per-line.
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

      // check_cost_guard — one batch call.
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

      // check_evidence_required — per-line; build doc_guardian_results + evidence_requirements.
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

      // check_hs_uae_compliance — only CUSTOMS lines.
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
        warnings: []
      };
    }
  };
}
