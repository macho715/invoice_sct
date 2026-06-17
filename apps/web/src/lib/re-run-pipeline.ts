import { randomUUID } from 'node:crypto';
import { STORE } from './job-store';
import { createParserClient } from './parser-client';
import { createCfMcpClient } from './cf-mcp-client';
import { buildExportRequest } from './workbook-builder';
import { mergeValidationIntoNormalizedInvoice } from './validation-merge';
import type { ReRunRecord, VisionStatusRecord } from './types';

// 2026-06-17: Re-run pipeline orchestrator.
//
// When Vision OCR completes with new lines/evidence (re_run_required: true),
// this pipeline replays parse → validate → export so the 13-sheet workbook
// reflects the OCR-augmented data without manual re-approval. The pipeline is
// fire-and-forget: callers receive a ReRunRecord immediately and poll
// /api/audit/re-run-status for completion.
//
// Idempotency: the dedupe key is (job_id, re_run_trigger, pdf_sha256). A
// previously-exported re-run with the same key returns the cached record and
// skips the worker call. An in-flight (running) record also returns cached.
//
// Rule #0: the pipeline never throws back to the caller. Errors are written
// to re_run_status = 'failed' with re_run_error_code/message, and the audit
// keeps the original (pre-OCR) workbook as the deliverable.

export interface ReRunOptions {
  jobId: string;
  triggeredBy: string;             // user id or 'auto:vision-status'
  trigger: 'manual' | 'vision_ocr_done';
  visionRecord?: VisionStatusRecord; // required when trigger === 'vision_ocr_done'
  // Optional pre-computed OCR JSON content. When omitted, the orchestrator
  // uses the vision_ocr_result already stored on the job (which carries
  // line/evidence counts but not the full body); the worker re-validate path
  // re-reads from GCS.
  ocrJsonOverride?: unknown;
}

export interface ReRunResult {
  reRun: ReRunRecord;
  triggered: boolean;              // false if a terminal/in-flight record was returned
}

const TERMINAL_STATUSES = new Set<ReRunRecord['re_run_status']>(['exported', 'failed']);

function makeId(): string {
  return `rerun_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildInitialRecord(opts: ReRunOptions): ReRunRecord {
  return {
    re_run_id: makeId(),
    re_run_status: 'pending',
    re_run_triggered_by: opts.triggeredBy,
    re_run_trigger: opts.trigger,
    re_run_pdf_sha256: opts.visionRecord?.vision_pdf_sha256 ?? null,
    re_run_vision_operation_name: opts.visionRecord?.vision_operation_name ?? null,
    re_run_started_at: null,
    re_run_completed_at: null,
    re_run_error_code: null,
    re_run_error_message: null,
    re_run_workbook_sha256: null,
    re_run_workbook_size_bytes: null,
    re_run_workbook_blob_url: null,
    re_run_prior_variance_aed: null,
    re_run_new_variance_aed: null,
    re_run_prior_verdict: null,
    re_run_new_verdict: null
  };
}

// Public entrypoint. Returns immediately with the initial record and kicks
// off the async pipeline. Caller should NOT await the actual work — they poll
// /api/audit/re-run-status for the workbook.
export async function triggerReRun(opts: ReRunOptions): Promise<ReRunResult> {
  const jobId = opts.jobId;
  const pdfSha = opts.visionRecord?.vision_pdf_sha256 ?? null;

  // Idempotency: skip if a terminal or in-flight record already exists for
  // the same trigger + pdf_sha256.
  const existing = await STORE.getReRunRecord(jobId);
  if (existing
      && existing.re_run_trigger === opts.trigger
      && existing.re_run_pdf_sha256 === pdfSha
      && (TERMINAL_STATUSES.has(existing.re_run_status) || existing.re_run_status === 'running')) {
    return { reRun: existing, triggered: false };
  }

  const record = buildInitialRecord(opts);
  await STORE.setReRunRecord(jobId, record);
  await STORE.appendTrace(jobId, {
    step: 'RE_RUN_TRIGGER',
    input_ref: opts.visionRecord?.vision_operation_name ?? jobId,
    output_ref: `RE_RUN_TRIGGERED:${record.re_run_id}`,
    source_hash: pdfSha ?? undefined,
    attributedTo: `re-run-pipeline:${opts.triggeredBy}`
  });

  // Fire-and-forget. The pipeline writes its own progress to the record.
  void runPipeline({ ...opts, reRunId: record.re_run_id }).catch((e) => {
    // Last-resort safety net. runPipeline already catches its own errors and
    // writes them to the record; this is for unexpected throws in the
    // orchestrator itself (e.g. STORE.setReRunRecord blowing up).
    const msg = e instanceof Error ? e.message : String(e);
    STORE.setReRunRecord(jobId, {
      ...record,
      re_run_status: 'failed',
      re_run_completed_at: nowIso(),
      re_run_error_code: 'RE_RUN_UNEXPECTED',
      re_run_error_message: msg
    }).catch(() => undefined);
  });

  return { reRun: record, triggered: true };
}

interface InternalOpts extends ReRunOptions { reRunId: string; }

async function runPipeline(opts: InternalOpts): Promise<void> {
  const { jobId, reRunId } = opts;

  // 1) Mark running.
  const running: ReRunRecord = {
    ...(await STORE.getReRunRecord(jobId) as ReRunRecord),
    re_run_status: 'running',
    re_run_started_at: nowIso()
  };
  await STORE.setReRunRecord(jobId, running);
  await STORE.appendTrace(jobId, {
    step: 'RE_RUN_START',
    input_ref: reRunId,
    output_ref: `RE_RUN_RUNNING`,
    attributedTo: 're-run-pipeline:orchestrator'
  });

  // 2) Read prior state for the variance delta.
  const job = await STORE.getJob(jobId);
  const priorResult = await STORE.getResult(jobId);
  const priorVariance = (priorResult as { variance_aed?: number } | null | undefined)?.variance_aed ?? null;
  const priorVerdict = job?.verdict ?? null;

  // 3) Re-validate using the OCR-augmented line set. Pull the latest
  //    normalized invoice + evidence from the store and feed them back into
  //    Cf MCP. The OCR merge step is owned by the worker when the original
  //    parse re-runs against the OCR JSON; this orchestrator just re-validates
  //    whatever the store currently has.
  const currentNormalized = await STORE.getNormalizedInvoice(jobId);
  const lines = (currentNormalized as { invoice_lines?: unknown[] } | null)?.invoice_lines ?? [];
  const evidence = (currentNormalized as { evidence_candidates?: unknown[] } | null)?.evidence_candidates ?? [];
  const cf = createCfMcpClient();
  let sct;
  try {
    sct = await cf.validate(jobId, {
      invoice_lines: lines,
      evidence_index: evidence,
      rule_version: job?.rule_version ?? 'rule-0.1.0',
      workflow_type: job?.workflow_type ?? 'SHIPMENT'
    });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'RE_RUN_VALIDATE_FAILED';
    const msg = e instanceof Error ? e.message : String(e);
    await failReRun(jobId, reRunId, code, msg);
    return;
  }
  await STORE.setValidationResult(jobId, sct as never);
  const merged = mergeValidationIntoNormalizedInvoice(
    (await STORE.getNormalizedInvoice(jobId)) as never,
    sct
  );
  await STORE.setNormalizedInvoice(jobId, merged as never);

  // 4) Re-export the 13-sheet workbook via the worker.
  const workerUrl = process.env.PARSER_WORKER_URL || process.env.WORKER_URL || '';
  const workerToken = process.env.PARSER_WORKER_TOKEN || '';
  if (!workerUrl || !workerToken) {
    await failReRun(jobId, reRunId, 'WORKER_CONFIG_MISSING', 'PARSER_WORKER_URL or PARSER_WORKER_TOKEN not configured.');
    return;
  }
  const parser = createParserClient({ baseUrl: workerUrl, token: workerToken });
  let exportResult;
  try {
    const exportReq = await buildExportRequest(jobId);
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
      body: JSON.stringify(exportReq)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      await failReRun(jobId, reRunId, 'EXPORT_FAILED', `Worker /v1/export returned ${res.status}: ${txt.slice(0, 200)}`);
      return;
    }
    exportResult = await res.json() as {
      job_id: string;
      kind: string;
      manifest?: { sha256: string; size_bytes: number };
      blob_url?: string;
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failReRun(jobId, reRunId, 'EXPORT_REQUEST_FAILED', msg);
    return;
  }

  // 5) Compute the new variance from the post-validate result.
  const newResult = await STORE.getResult(jobId);
  const newVariance = (newResult as { variance_aed?: number } | null | undefined)?.variance_aed ?? null;
  const newVerdict = (newResult as { verdict?: string } | null | undefined)?.verdict ?? job?.verdict ?? null;

  // 6) Mark exported. Workbook URL/sha256/size come from the worker response.
  const exported: ReRunRecord = {
    ...(await STORE.getReRunRecord(jobId) as ReRunRecord),
    re_run_status: 'exported',
    re_run_completed_at: nowIso(),
    re_run_workbook_sha256: exportResult.manifest?.sha256 ?? null,
    re_run_workbook_size_bytes: exportResult.manifest?.size_bytes ?? null,
    re_run_workbook_blob_url: exportResult.blob_url ?? null,
    re_run_prior_variance_aed: priorVariance,
    re_run_new_variance_aed: newVariance,
    re_run_prior_verdict: priorVerdict,
    re_run_new_verdict: newVerdict
  };
  await STORE.setReRunRecord(jobId, exported);
  await STORE.appendTrace(jobId, {
    step: 'RE_RUN_EXPORT',
    input_ref: reRunId,
    output_ref: `RE_RUN_EXPORTED:${exported.re_run_workbook_sha256 ?? 'no-sha'}`,
    source_hash: opts.visionRecord?.vision_pdf_sha256 ?? undefined,
    attributedTo: 're-run-pipeline:orchestrator'
  });
}

async function failReRun(jobId: string, reRunId: string, code: string, message: string): Promise<void> {
  const prior = await STORE.getReRunRecord(jobId);
  if (!prior) return;
  const failed: ReRunRecord = {
    ...prior,
    re_run_status: 'failed',
    re_run_completed_at: nowIso(),
    re_run_error_code: code,
    re_run_error_message: message
  };
  await STORE.setReRunRecord(jobId, failed);
  await STORE.appendTrace(jobId, {
    step: 'RE_RUN_FAIL',
    input_ref: reRunId,
    output_ref: `RE_RUN_FAILED:${code}`,
    attributedTo: 're-run-pipeline:orchestrator'
  });
}
