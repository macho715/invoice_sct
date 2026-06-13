import { NextResponse } from 'next/server';
import { createJobStore, STORE } from '@/lib/job-store';
import { createParserClient } from '@/lib/parser-client';
import { createCfMcpClient, McpUnavailableError } from '@/lib/cf-mcp-client';
import { buildGateResult, checkReconciliation } from '@/lib/gate-bridge';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { getSignedDownloadUrl } from '@/lib/blob';

export const runtime = 'nodejs';
void createJobStore;

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

async function parseBody(req: Request): Promise<{ job_id?: string } | null> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { return await req.json(); } catch { return null; }
  }
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    try { const fd = await req.formData(); const jid = fd.get('job_id'); return jid ? { job_id: String(jid) } : null; } catch { return null; }
  }
  try { return await req.json(); } catch {}
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const body = await parseBody(req);
  if (!body) return err('INVALID_STATE', 'invalid json body');
  if (!body.job_id) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(body.job_id);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  if (job.status !== 'UPLOADED' && job.status !== 'QUEUED') return err('INVALID_STATE', `cannot run from status ${job.status}`);
  const files = await STORE.listSourceFiles(body.job_id);
  if (files.length === 0) return err('INVALID_STATE', 'no source files');
  await STORE.updateJob(body.job_id, { status: 'PARSING' });
  const file = files[0];
  const parser = createParserClient({ baseUrl: process.env.PARSER_WORKER_URL ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8000', token: process.env.PARSER_WORKER_TOKEN ?? 'dev' });
  let parseRes;
  try {
    const blobUrl = await getSignedDownloadUrl(file.blob_ref);
    const basePayload = {
      blob_ref: file.blob_ref, file_id: file.file_id, job_id: body.job_id,
      file_type: file.file_type as 'xlsx' | 'md' | 'txt' | 'pdf',
      parser_version: job.parser_version,
      blob_url: blobUrl
    };
    if (file.file_type === 'pdf') {
      parseRes = await parser.parsePdfText(basePayload);  // P3B
    } else {
      parseRes = await parser.parse(basePayload as any);
    }
  } catch (e) {
    const msg = (e as Error).message || '';
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    if (msg.includes('PARSE_PDF_UNSUPPORTED') || msg.includes('PARSE_PDF_LOW_CONFIDENCE')) {
      const code: ErrorCode = msg.includes('PARSE_PDF_UNSUPPORTED') ? 'PARSE_PDF_UNSUPPORTED' : 'PARSE_PDF_LOW_CONFIDENCE';
      return err(code, msg);
    }
    return err('PARSE_FAILED', msg);
  }
  // P3C: low-confidence AMBER gate for PDF (plan §6.2, FR-071) - force AMBER regardless of CostGuard
  const pconf = (parseRes as any)?.normalized?.parser_confidence ?? 1.0;
  const isPdfLowConf = file.file_type === 'pdf' && pconf < 0.85;
  await STORE.appendTrace(body.job_id, {
    step: 'PARSE',
    input_ref: file.file_type === 'pdf' ? `${file.blob_ref}|pdf_page=1` : file.blob_ref,
    output_ref: parseRes.parse_result_id,
    source_hash: file.sha256,
    calculation_hash: parseRes.parse_result_id,
    attributedTo: file.file_type === 'pdf' ? 'python-worker:pdfplumber' : 'python-worker'
  });
  await STORE.setNormalizedInvoice(body.job_id, parseRes.normalized as any);

  // Phase 3 reviewer feedback + domestic fullset 이식: 완전 pdf_source_data population
  // Use source_data returned from parser (built from actual text_spans in py route, ported from fullset build_supporting_doc_extractions / _extract_doc_fields)
  const pdfSourceData = (parseRes as any).source_data || [];
  if (file.file_type === 'pdf' && pdfSourceData.length > 0) {
    // In real flow, feed to STORE or export builder for 90_Source_Data with real original_text, pdf_page, text_span_hash
    await STORE.appendTrace(body.job_id, {
      step: 'SOURCE_DATA',
      input_ref: file.file_id,
      output_ref: `pdf_spans:${pdfSourceData.length}`,
      attributedTo: 'domestic-fullset-port'
    });
    // TODO: if STORE supports, await STORE.setSourceDataRows(body.job_id, pdfSourceData);
  }

  await STORE.updateJob(body.job_id, { status: 'VALIDATING' });
  const cf = createCfMcpClient({ baseUrl: process.env.CF_MCP_BASE_URL ?? process.env.MCP_SERVER_URL ?? 'https://hvdc-ontology-chatgpt-app.mscho715.workers.dev', timeoutMs: Number(process.env.CF_MCP_TIMEOUT_MS ?? 5000), retries: 3 });
  let sct;
  try {
    sct = await cf.validate(body.job_id, {
      invoice_lines: (parseRes.normalized as { invoice_lines: unknown[] }).invoice_lines,
      evidence_index: (parseRes.normalized as { evidence_candidates: unknown[] }).evidence_candidates,
      rule_version: job.rule_version
    });
  } catch (e: any) {
    if (e instanceof McpUnavailableError) return err('MCP_UNAVAILABLE', e.message);
    const code = e.code || 'VALIDATION_FAILED';
    return err(code as ErrorCode, e.message);
  }

  await STORE.setValidationResult(body.job_id, sct as any);

  for (const tc of sct.cf_mcp_tool_calls) {
    await STORE.appendTrace(body.job_id, {
      step: tc.tool === 'check_cost_guard' ? 'COSTGUARD' : tc.tool === 'check_doc_guardian' ? 'DOC_GUARDIAN' : tc.tool === 'classify_type_b' ? 'VALIDATE' : tc.tool === 'check_hs_uae_compliance' ? 'VALIDATE' : 'VALIDATE',
      input_ref: parseRes.parse_result_id, output_ref: tc.tool, latency_ms: tc.latency_ms, attributedTo: `cf-mcp:${tc.tool}`
    });
  }
  const typeBClassCount = sct.type_b_results.reduce<Record<string, number>>((acc, t) => { acc[t.type_b] = (acc[t.type_b] || 0) + 1; return acc; }, {});
  const evidenceFindings = [...sct.doc_guardian_results.map(d => ({ line_id: d.line_id, code: d.code, severity: d.severity }))];
  for (const hs of sct.hs_uae_results) {
    evidenceFindings.push({ line_id: hs.line_id, code: hs.reason_code ?? 'HS_UAE_CHECK', severity: hs.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
  }
  const gate = buildGateResult(body.job_id, sct.costguard_results.map(c => ({ line_id: c.line_id, band: c.band, delta_pct: c.delta_pct, reason_codes: [`COSTGUARD_${c.band}`] })), evidenceFindings);
  const normalized = parseRes.normalized as any;
  const invoiceTotal = normalized?.invoice_header?.invoice_total ?? null;
  const lineAuditTotal = (normalized?.invoice_lines as any[] | undefined)?.reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0) ?? 0;
  const typeBTotal: number | null = sct.type_b_results.length > 0
    ? (normalized?.invoice_lines as any[] | undefined)?.reduce((sum: number, l: any) => {
        const hasTypeB = sct.type_b_results.some(t => t.line_id === l.line_id);
        return sum + (hasTypeB ? (Number(l.amount) || 0) : 0);
      }, 0) ?? 0
    : null;
  const recon = checkReconciliation(invoiceTotal, lineAuditTotal, typeBTotal);
  let finalVerdict = isPdfLowConf ? 'AMBER' : gate.verdict;
  const actionItems = [...(gate.action_items || [])];
  if (!recon.ok && recon.verdict !== 'PASS') {
    const VERDICT_RANK: Record<string, number> = { PASS: 0, AMBER: 1, ZERO: 2, FAILED: 3 };
    if (VERDICT_RANK[recon.verdict] > VERDICT_RANK[finalVerdict]) finalVerdict = recon.verdict;
    actionItems.push({
      action_id: `act_recon_${body.job_id}`,
      severity: recon.verdict,
      line_id: '',
      issue_type: recon.reason ?? 'RECONCILIATION',
      required_action: recon.verdict === 'ZERO' ? 'TYPE-B total mismatch — Contract/Admin review required' : 'Line audit total mismatch — review line items'
    });
  }
  if (isPdfLowConf) {
    // P3C §6.2: push explicit action per plan snippet
    actionItems.push({
      action_id: `act_pdf_low_${body.job_id}`,
      severity: 'AMBER',
      line_id: '',
      issue_type: 'PDF_LOW_CONFIDENCE',
      required_action: 'Human review of PDF extraction; re-upload higher quality scan if needed.',
    });
    await STORE.appendTrace(body.job_id, { step: 'AMBER_OVERRIDE', input_ref: 'parser_confidence<0.85', output_ref: 'AMBER', attributedTo: 'pdf-low-conf-gate' });
  }
  await STORE.setResult(body.job_id, { ...gate, verdict: finalVerdict, action_items: actionItems });
  await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: finalVerdict });
  await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: sct.sct_trace_id, output_ref: gate.gate_id, attributedTo: 'gate-bridge' });
  return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: finalVerdict, action_items: actionItems }, { status: 202 });
}
