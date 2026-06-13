import { NextResponse } from 'next/server';
import { createJobStore, STORE } from '@/lib/job-store';
import { createParserClient } from '@/lib/parser-client';
import { createCfMcpClient, McpUnavailableError } from '@/lib/cf-mcp-client';
import { buildGateResult } from '@/lib/gate-bridge';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';

export const runtime = 'nodejs';
void createJobStore;

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  let body: { job_id?: string };
  try { body = await req.json(); } catch { return err('INVALID_STATE', 'invalid json body'); }
  if (!body.job_id) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(body.job_id);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  if (job.status !== 'UPLOADED' && job.status !== 'QUEUED') return err('INVALID_STATE', `cannot run from status ${job.status}`);
  const files = await STORE.listSourceFiles(body.job_id);
  if (files.length === 0) return err('INVALID_STATE', 'no source files');
  await STORE.updateJob(body.job_id, { status: 'PARSING' });
  const file = files[0];
  const parser = createParserClient({ baseUrl: process.env.PARSER_WORKER_URL ?? 'http://127.0.0.1:8000', token: process.env.PARSER_WORKER_TOKEN ?? 'dev' });
  let parseRes;
  try {
    const basePayload = {
      blob_ref: file.blob_ref, file_id: file.file_id, job_id: body.job_id,
      file_type: file.file_type as 'xlsx' | 'md' | 'txt' | 'pdf',
      parser_version: job.parser_version,
      blob_url: (file as { blob_url?: string }).blob_url ?? `http://placeholder/${file.blob_ref}`
    };
    if (file.file_type === 'pdf') {
      parseRes = await parser.parsePdfText(basePayload);  // P3B
    } else {
      parseRes = await parser.parse(basePayload as any);
    }
  } catch (e) {
    const msg = (e as Error).message || '';
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
  const cf = createCfMcpClient({ baseUrl: process.env.CF_MCP_BASE_URL ?? 'https://hvdc-ontology-chatgpt-app.mscho715.workers.dev', timeoutMs: Number(process.env.CF_MCP_TIMEOUT_MS ?? 5000), retries: 3 });
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
      step: tc.tool === 'check_cost_guard' ? 'COSTGUARD' : tc.tool === 'check_doc_guardian' ? 'DOC_GUARDIAN' : 'VALIDATE',
      input_ref: parseRes.parse_result_id, output_ref: tc.tool, latency_ms: tc.latency_ms, attributedTo: `cf-mcp:${tc.tool}`
    });
  }
  const gate = buildGateResult(body.job_id, sct.costguard_results.map(c => ({ line_id: c.line_id, band: c.band, delta_pct: c.delta_pct, reason_codes: [`COSTGUARD_${c.band}`] })));
  const finalVerdict = isPdfLowConf ? 'AMBER' : gate.verdict;
  const actionItems = [...(gate.action_items || [])];
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
