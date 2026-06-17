import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { createParserClient } from '@/lib/parser-client';
import { requireJobToken } from '@/lib/job-token';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import { triggerReRun } from '@/lib/re-run-pipeline';
import type {
  VisionOcrResult, VisionStatusRecord
} from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

// Public response shape. The route returns the same keys regardless of
// whether Vision was never requested (vision_status: null) or in flight
// (`running`) or terminal (`done` / `failed` / `skipped`). Clients can poll
// this route on a fixed interval until vision_status is in the terminal set.
export interface VisionStatusResponse {
  job_id: string;
  vision_status: VisionStatusRecord['vision_status'] | null;
  vision_operation_name: string | null;
  vision_pdf_file_id: string | null;
  vision_started_at: string | null;
  vision_completed_at: string | null;
  vision_updated_at: string | null;
  vision_error_code: string | null;
  vision_error_message: string | null;
  page_count: number | null;
  confidence: number | null;
  ocr_json_gcs_uri: string | null;
  ocr_json_gcs_uris: string[];
  invoice_lines_count: number;
  evidence_candidates_count: number;
  issues: string[];
  // Hint to the caller. `re_run_required: true` means OCR succeeded with
  // new lines/evidence and the audit pipeline should be re-run via
  // POST /api/audit/export to refresh the 13-sheet workbook.
  re_run_required: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<VisionStatusRecord['vision_status']> =
  new Set(['done', 'failed', 'skipped']);

function publicShape(jobId: string, rec: VisionStatusRecord | undefined): VisionStatusResponse {
  if (!rec) {
    return {
      job_id: jobId,
      vision_status: null,
      vision_operation_name: null,
      vision_pdf_file_id: null,
      vision_started_at: null,
      vision_completed_at: null,
      vision_updated_at: null,
      vision_error_code: null,
      vision_error_message: null,
      page_count: null,
      confidence: null,
      ocr_json_gcs_uri: null,
      ocr_json_gcs_uris: [],
      invoice_lines_count: 0,
      evidence_candidates_count: 0,
      issues: [],
      re_run_required: false
    };
  }
  const ocr = rec.vision_ocr_result;
  return {
    job_id: jobId,
    vision_status: rec.vision_status,
    vision_operation_name: rec.vision_operation_name,
    vision_pdf_file_id: rec.vision_pdf_file_id,
    vision_started_at: rec.vision_started_at,
    vision_completed_at: rec.vision_completed_at,
    vision_updated_at: rec.vision_updated_at,
    vision_error_code: rec.vision_error_code,
    vision_error_message: rec.vision_error_message,
    page_count: ocr?.page_count ?? null,
    confidence: ocr?.confidence ?? null,
    ocr_json_gcs_uri: ocr?.ocr_json_gcs_uri ?? null,
    ocr_json_gcs_uris: ocr?.ocr_json_gcs_uris ?? [],
    invoice_lines_count: ocr?.invoice_lines?.length ?? 0,
    evidence_candidates_count: ocr?.evidence_candidates?.length ?? 0,
    issues: ocr?.issues ?? [],
    re_run_required: rec.vision_status === 'done'
      && Boolean(ocr) && ((ocr?.page_count ?? 0) > 0 || (ocr?.evidence_candidate_count ?? 0) > 0)
  };
}

function buildVisionStatus(
  patch: Partial<VisionStatusRecord> & { vision_status: VisionStatusRecord['vision_status'] }
): VisionStatusRecord {
  const now = new Date().toISOString();
  return {
    vision_status: patch.vision_status,
    vision_operation_name: patch.vision_operation_name ?? null,
    vision_pdf_file_id: patch.vision_pdf_file_id ?? null,
    vision_pdf_sha256: patch.vision_pdf_sha256 ?? null,
    vision_source_gcs_uri: patch.vision_source_gcs_uri ?? null,
    vision_output_gcs_prefix: patch.vision_output_gcs_prefix ?? null,
    vision_started_at: patch.vision_started_at ?? null,
    vision_completed_at: patch.vision_completed_at ?? null,
    vision_updated_at: patch.vision_updated_at ?? now,
    vision_error_code: patch.vision_error_code ?? null,
    vision_error_message: patch.vision_error_message ?? null,
    vision_ocr_result: patch.vision_ocr_result ?? null
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return err('INVALID_STATE', 'invalid json body');
  }
  const jobId = body.job_id;
  if (!jobId) {
    return err('INVALID_STATE', 'job_id is required');
  }

  const job = await STORE.getJob(jobId);
  if (!job) {
    return err('JOB_NOT_FOUND', 'unknown job_id');
  }
  const tokenError = requireJobToken(req, job);
  if (tokenError) return tokenError;

  const current = await STORE.getVisionStatus(jobId);

  // No Vision state on this job — the reviewer never opted in. Return
  // a stable `vision_status: null` shape so the client can short-circuit
  // the polling loop without surfacing an error.
  if (!current) {
    return NextResponse.json(publicShape(jobId, undefined));
  }

  // Terminal state — return cached record verbatim. The OCR result is
  // immutable once `done`; callers should re-call /api/audit/export if
  // `re_run_required: true` to refresh the 13-sheet workbook.
  if (current.vision_status && TERMINAL_STATUSES.has(current.vision_status)) {
    return NextResponse.json(publicShape(jobId, current));
  }

  // `running` / `pending` / `queued` — poll the worker for a fresh
  // operation status. We always go through the worker instead of trusting
  // our cached state so multiple reviewers / cron pollers see the same
  // authoritative answer.
  if (current.vision_status === 'running' || current.vision_status === 'pending' || current.vision_status === 'queued') {
    if (!current.vision_operation_name) {
      // No operation handle — treat as failed. The previous trigger never
      // produced a usable operation_name (e.g. worker was not configured).
      const failed = buildVisionStatus({
        ...current,
        vision_status: 'failed',
        vision_completed_at: new Date().toISOString(),
        vision_error_code: 'VISION_OPERATION_NAME_MISSING',
        vision_error_message: 'Vision record is in flight but has no operation_name; cannot poll worker.'
      });
      await STORE.setVisionStatus(jobId, failed);
      await STORE.appendTrace(jobId, {
        step: 'VISION_RUN',
        input_ref: jobId,
        output_ref: 'VISION_FAILED_NO_OPERATION',
        attributedTo: 'vision-status:collect'
      });
      return NextResponse.json(publicShape(jobId, failed));
    }

    const workerUrl = process.env.PARSER_WORKER_URL || process.env.WORKER_URL || '';
    const workerToken = process.env.PARSER_WORKER_TOKEN || '';
    if (!workerUrl || !workerToken) {
      return NextResponse.json(publicShape(jobId, current));
    }
    const parser = createParserClient({ baseUrl: workerUrl, token: workerToken });
    const collect = await parser.collectVisionOcr({
      job_id: jobId,
      file_id: current.vision_pdf_file_id ?? '',
      operation_name: current.vision_operation_name,
      output_gcs_prefix: current.vision_output_gcs_prefix ?? undefined
    });

    if (collect.status === 'RUNNING') {
      // Still in flight — update `vision_updated_at` so the client can see
      // liveness, and return the same status. We do not call setVisionStatus
      // on every poll to keep the audit trail compact; the trace captures
      // the progress.
      const tick = buildVisionStatus({ ...current, vision_status: 'running' });
      await STORE.setVisionStatus(jobId, tick);
      return NextResponse.json(publicShape(jobId, tick));
    }

    if (collect.status === 'COLLECTED') {
      const ocrResult: VisionOcrResult = {
        page_count: collect.page_count ?? 0,
        confidence: collect.confidence ?? 0,
        ocr_json_gcs_uri: collect.ocr_json_gcs_uri ?? null,
        ocr_json_gcs_uris: collect.ocr_json_gcs_uris ?? [],
        invoice_lines: [],          // worker does not return full lines on /collect
        evidence_candidates: [],    // worker does not return evidence on /collect
        evidence_candidate_count: collect.evidence_candidate_count,
        issues: collect.issues ?? []
      };
      const done = buildVisionStatus({
        ...current,
        vision_status: 'done',
        vision_completed_at: new Date().toISOString(),
        vision_ocr_result: ocrResult
      });
      await STORE.setVisionStatus(jobId, done);
      await STORE.appendTrace(jobId, {
        step: 'VISION_RUN',
        input_ref: current.vision_operation_name,
        output_ref: `VISION_DONE:${collect.ocr_json_gcs_uri ?? 'no-uri'}`,
        source_hash: current.vision_pdf_sha256 ?? undefined,
        attributedTo: 'vision-status:collect'
      });

      // 2026-06-17: when OCR returned new content (pages or evidence
      // candidates), auto-trigger the re-run pipeline (re-parse →
      // re-validate → re-export). The pipeline is idempotent on
      // (job_id, trigger, pdf_sha256) so polling again after the re-run
      // completes returns the cached record. The response shape still
      // surfaces the original `re_run_required: true` hint so the client
      // can either trigger manually or wait for the auto run.
      const ocrLineCount = ocrResult.invoice_lines?.length ?? 0;
      const ocrEvidenceCount = ocrResult.evidence_candidates?.length ?? 0;
      const evidenceCount = ocrResult.evidence_candidate_count ?? 0;
      const reRunRequired = ocrLineCount > 0
        || ocrEvidenceCount > 0
        || (ocrResult.page_count ?? 0) > 0
        || evidenceCount > 0;
      if (reRunRequired) {
        try {
          const { triggered } = await triggerReRun({
            jobId,
            triggeredBy: 'auto:vision-status',
            trigger: 'vision_ocr_done',
            visionRecord: done
          });
          if (triggered) {
            await STORE.appendTrace(jobId, {
              step: 'RE_RUN_AUTO',
              input_ref: current.vision_operation_name,
              output_ref: 'RE_RUN_AUTO_TRIGGERED',
              source_hash: current.vision_pdf_sha256 ?? undefined,
              attributedTo: 'vision-status:auto-re-run'
            });
          }
        } catch (e) {
          // Re-run trigger is best-effort; never block the vision-status
          // response. The audit can still be re-triggered manually via
          // POST /api/audit/re-run.
          await STORE.appendTrace(jobId, {
            step: 'RE_RUN_AUTO',
            input_ref: current.vision_operation_name,
            output_ref: `RE_RUN_AUTO_TRIGGER_FAILED:${(e as Error)?.message ?? 'unknown'}`,
            source_hash: current.vision_pdf_sha256 ?? undefined,
            attributedTo: 'vision-status:auto-re-run'
          }).catch(() => undefined);
        }
      }

      return NextResponse.json(publicShape(jobId, done));
    }

    // Anything else (VISION_DISABLED, VISION_OUTPUT_NOT_FOUND, COLLECT_FAILED,
    // COLLECT_TIMEOUT) is treated as `failed` and the audit pipeline can
    // fall back to the AMBER Review Pack that was already produced.
    const failed = buildVisionStatus({
      ...current,
      vision_status: 'failed',
      vision_completed_at: new Date().toISOString(),
      vision_error_code: collect.error_code ?? collect.status,
      vision_error_message: `Worker /v1/vision/collect returned ${collect.status}.`
    });
    await STORE.setVisionStatus(jobId, failed);
    await STORE.appendTrace(jobId, {
      step: 'VISION_RUN',
      input_ref: current.vision_operation_name,
      output_ref: `VISION_FAILED:${collect.status}`,
      source_hash: current.vision_pdf_sha256 ?? undefined,
      attributedTo: 'vision-status:collect'
    });
    return NextResponse.json(publicShape(jobId, failed));
  }

  // Unknown / null status — return as-is for forward compatibility.
  return NextResponse.json(publicShape(jobId, current));
}

// Optional GET fallback for clients that prefer query-string polling. Same
// behavior as POST with body { job_id }. Enabled so the README's `GET
// /api/audit/vision-status?job_id=…` example works without a body.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return err('INVALID_STATE', 'job_id required');
  return POST(new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ job_id: jobId })
  }));
}
