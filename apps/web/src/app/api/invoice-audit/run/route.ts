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
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  const body = await parseBody(req);
  if (!body) return err('INVALID_STATE', 'invalid json body');
  if (!body.job_id) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(body.job_id);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  if (job.status !== 'UPLOADED' && job.status !== 'QUEUED') return err('INVALID_STATE', `cannot run from status ${job.status}`);
  const files = await STORE.listSourceFiles(body.job_id);
  if (files.length === 0) return err('INVALID_STATE', 'no source files');

  // Rule #0 (CLAUDE.md): Excel invoice OR PDF evidence — either alone must yield a
  // final Excel. Prefer a structured doc (xlsx/md/txt) as the invoice source; if none
  // was uploaded, fall back to the first PDF as the primary invoice source and treat
  // the remaining PDFs as evidence. A PDF source typically yields 0 structured lines,
  // which the zero-lines guard below routes to AMBER/REVIEW_REQUIRED — still producing
  // a result the workbook can be built from. We never 409 a PDF-only upload.
  const docInvoice = files.find(f => f.file_type === 'xlsx' || f.file_type === 'md' || f.file_type === 'txt');
  const pdfFiles = files.filter(f => f.file_type === 'pdf');
  const invoiceFile = docInvoice ?? pdfFiles[0];
  const evidenceFiles = docInvoice ? pdfFiles : pdfFiles.slice(1);

  if (!invoiceFile) {
    return err('INVALID_STATE', 'no invoice or evidence file uploaded (expected xlsx, md, txt, or pdf)');
  }

  await STORE.updateJob(body.job_id, { status: 'PARSING' });

  const parserToken = process.env.PARSER_WORKER_TOKEN;
  if (!parserToken) {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'PARSER_WORKER_TOKEN not configured');
  }
  const workerUrl = process.env.PARSER_WORKER_URL ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8000';
  let parsed: URL;
  try {
    parsed = new URL(workerUrl);
  } catch {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'WORKER_URL must be a valid URL');
  }
  const allowedHosts = ['127.0.0.1', 'localhost', '.fly.dev', '.run.app', '.internal', '.vercel.app'];
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(h))) {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'WORKER_URL must point to an allowed parser worker host');
  }
  const parser = createParserClient({ baseUrl: workerUrl, token: parserToken });
  let parseRes;
  try {
    const blobUrl = await getSignedDownloadUrl(invoiceFile.blob_ref);
    const basePayload = {
      blob_ref: invoiceFile.blob_ref, file_id: invoiceFile.file_id, job_id: body.job_id,
      file_type: invoiceFile.file_type as 'xlsx' | 'md' | 'txt' | 'pdf',
      parser_version: job.parser_version,
      blob_url: blobUrl
    };
    parseRes = await parser.parse(basePayload as any);
  } catch (e) {
    const msg = (e as Error).message || '';
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('PARSE_FAILED', msg);
  }

  await STORE.appendTrace(body.job_id, {
    step: 'PARSE',
    input_ref: invoiceFile.blob_ref,
    output_ref: parseRes.parse_result_id,
    source_hash: invoiceFile.sha256,
    calculation_hash: parseRes.parse_result_id,
    attributedTo: 'python-worker'
  });
  await STORE.setNormalizedInvoice(body.job_id, parseRes.normalized as any);

  // Phase 1: MarkItDown -> NotebookLM dual-extraction trigger (verification path).
  // Flag-gated (default OFF) and fire-and-forget — the pdfplumber result above stays
  // the source of truth for validation/gate. The worker (Fly, long-running) runs the
  // orchestrator and POSTs its first-pass extraction to /api/notebooklm/ingest-summary,
  // which cross-checks it against this parser result. A trigger failure must never
  // affect the audit verdict, so it is fully isolated in a catch.
  // NOTE: enabling this sends invoice/evidence content to the external NotebookLM
  // service — confirm P2/DLP policy before flipping NOTEBOOKLM_ENABLED on in prod.
  if (process.env.NOTEBOOKLM_ENABLED === 'true') {
    const nbJobId = body.job_id;
    const nbBlobRef = invoiceFile.blob_ref;
    void (async () => {
      try {
        const nbBlobUrl = await getSignedDownloadUrl(nbBlobRef);
        const res = await parser.runNotebookLm({
          job_id: nbJobId,
          blob_url: nbBlobUrl,
          notebook_id: process.env.NOTEBOOKLM_NOTEBOOK_ID
        });
        await STORE.appendTrace(nbJobId, {
          step: 'NOTEBOOKLM', input_ref: nbBlobRef,
          output_ref: res.status ?? 'TRIGGERED', attributedTo: 'run-route:notebooklm-trigger'
        });
      } catch {
        await STORE.appendTrace(nbJobId, {
          step: 'NOTEBOOKLM', input_ref: nbBlobRef,
          output_ref: 'TRIGGER_FAILED', attributedTo: 'run-route:notebooklm-trigger'
        }).catch(() => undefined);
      }
    })();
  }

  // P0-4: parser extracted zero invoice lines (empty/unmapped invoice, or PDF text
  // with no structured lines). Validating [] would yield empty COST-GUARD results and
  // a false PASS, so short-circuit to AMBER and route to human review instead.
  const parsedLines = ((parseRes.normalized as { invoice_lines?: unknown[] })?.invoice_lines) ?? [];
  if (parsedLines.length === 0) {
    const actionItems = [{
      action_id: `act_nolines_${body.job_id}`,
      severity: 'AMBER' as const,
      line_id: '',
      issue_type: 'NO_INVOICE_LINES_EXTRACTED',
      required_action: 'Parser extracted 0 invoice lines — verify file/column mapping or supply a structured invoice'
    }];
    await STORE.setResult(body.job_id, { gate_id: `gate_nolines_${body.job_id}`, job_id: body.job_id, verdict: 'AMBER', line_results: [], action_items: actionItems } as any);
    await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: parseRes.parse_result_id, output_ref: 'NO_INVOICE_LINES_EXTRACTED', attributedTo: 'run-route:guard' });
    return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: 'AMBER', action_items: actionItems }, { status: 202 });
  }

  const mergedEvidence = [...((parseRes.normalized as any)?.evidence_candidates ?? [])];
  for (const evFile of evidenceFiles) {
    try {
      const evBlobUrl = await getSignedDownloadUrl(evFile.blob_ref);
      const evPayload = {
        blob_ref: evFile.blob_ref, file_id: evFile.file_id, job_id: body.job_id,
        file_type: 'pdf' as const, parser_version: job.parser_version, blob_url: evBlobUrl
      };
      const evParse = await parser.parsePdfText(evPayload);
      const evCandidates = (evParse.normalized as any)?.evidence_candidates ?? [];
      mergedEvidence.push(...evCandidates);
      await STORE.appendTrace(body.job_id, {
        step: 'EVIDENCE_PARSE',
        input_ref: evFile.blob_ref,
        output_ref: `evidence_candidates:${evCandidates.length}`,
        source_hash: evFile.sha256,
        attributedTo: 'python-worker:pdfplumber'
      });
    } catch {
      await STORE.appendTrace(body.job_id, { step: 'EVIDENCE_PARSE', input_ref: evFile.blob_ref, output_ref: 'SKIPPED', attributedTo: 'python-worker:pdfplumber' });
    }
  }

  await STORE.updateJob(body.job_id, { status: 'VALIDATING' });
  // MCP validation tools now run in-process (apps/web/src/lib/mcp) — no external MCP URL needed.
  const cf = createCfMcpClient();
  let sct;
  try {
    sct = await cf.validate(body.job_id, {
      invoice_lines: (parseRes.normalized as { invoice_lines: unknown[] }).invoice_lines,
      evidence_index: mergedEvidence,
      rule_version: job.rule_version
    });
  } catch (e: any) {
    // Mirror the parse catch: persist FAILED so the job does not get stuck in
    // VALIDATING (which would reject re-runs with "cannot run from status VALIDATING").
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    await STORE.appendTrace(body.job_id, {
      step: 'VALIDATE',
      input_ref: parseRes.parse_result_id,
      output_ref: e?.code ?? 'VALIDATION_FAILED',
      attributedTo: 'cf-mcp:error'
    }).catch(() => undefined);
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
  let finalVerdict = gate.verdict;
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
  await STORE.setResult(body.job_id, { ...gate, verdict: finalVerdict, action_items: actionItems });
  await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: finalVerdict });
  await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: sct.sct_trace_id, output_ref: gate.gate_id, attributedTo: 'gate-bridge' });
  return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: finalVerdict, action_items: actionItems }, { status: 202 });
}
