import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { requireJobToken } from '@/lib/job-token';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import type { ReRunRecord } from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

// Public response shape. Mirrors the vision-status response: stable keys
// regardless of pipeline state. `null` re_run_status means the auto-trigger
// has not run yet (or the job has no Vision record).
export interface ReRunStatusResponse {
  job_id: string;
  re_run_id: string | null;
  re_run_status: ReRunRecord['re_run_status'] | null;
  re_run_trigger: ReRunRecord['re_run_trigger'] | null;
  re_run_triggered_by: string | null;
  re_run_pdf_sha256: string | null;
  re_run_started_at: string | null;
  re_run_completed_at: string | null;
  re_run_error_code: string | null;
  re_run_error_message: string | null;
  re_run_workbook_sha256: string | null;
  re_run_workbook_size_bytes: number | null;
  re_run_workbook_blob_url: string | null;
  re_run_prior_variance_aed: number | null;
  re_run_new_variance_aed: number | null;
  re_run_prior_verdict: string | null;
  re_run_new_verdict: string | null;
  // True when the re-run has produced a fresh workbook the client can
  // download. Equivalent to (re_run_status === 'exported' && blob_url).
  ready_to_download: boolean;
}

function publicShape(jobId: string, rec: ReRunRecord | undefined): ReRunStatusResponse {
  if (!rec) {
    return {
      job_id: jobId,
      re_run_id: null,
      re_run_status: null,
      re_run_trigger: null,
      re_run_triggered_by: null,
      re_run_pdf_sha256: null,
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
      re_run_new_verdict: null,
      ready_to_download: false
    };
  }
  return {
    job_id: jobId,
    re_run_id: rec.re_run_id,
    re_run_status: rec.re_run_status,
    re_run_trigger: rec.re_run_trigger,
    re_run_triggered_by: rec.re_run_triggered_by,
    re_run_pdf_sha256: rec.re_run_pdf_sha256,
    re_run_started_at: rec.re_run_started_at,
    re_run_completed_at: rec.re_run_completed_at,
    re_run_error_code: rec.re_run_error_code,
    re_run_error_message: rec.re_run_error_message,
    re_run_workbook_sha256: rec.re_run_workbook_sha256,
    re_run_workbook_size_bytes: rec.re_run_workbook_size_bytes,
    re_run_workbook_blob_url: rec.re_run_workbook_blob_url,
    re_run_prior_variance_aed: rec.re_run_prior_variance_aed,
    re_run_new_variance_aed: rec.re_run_new_variance_aed,
    re_run_prior_verdict: rec.re_run_prior_verdict,
    re_run_new_verdict: rec.re_run_new_verdict,
    ready_to_download: rec.re_run_status === 'exported' && Boolean(rec.re_run_workbook_blob_url)
  };
}

async function handle(req: Request): Promise<Response> {
  const jobId = await extractJobId(req);
  if (!jobId) return err('INVALID_STATE', 'job_id is required');

  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const tokenError = requireJobToken(req, job, jobId ? { job_id: jobId } : undefined);
  if (tokenError) return tokenError;

  const rec = await STORE.getReRunRecord(jobId);
  return NextResponse.json(publicShape(jobId, rec));
}

async function extractJobId(req: Request): Promise<string | null> {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    return url.searchParams.get('job_id');
  }
  // POST
  let body: { job_id?: string };
  try {
    body = await req.clone().json();
  } catch {
    return null;
  }
  return body.job_id ?? null;
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
