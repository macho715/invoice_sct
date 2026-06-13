import { NextResponse } from 'next/server';
import { createJobStore, STORE } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';

export const runtime = 'nodejs';
void createJobStore;

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const trace = await STORE.listTrace(jobId);
  const last_step = trace.length > 0 ? trace[trace.length - 1].step : null;
  return NextResponse.json({ job_id: job.job_id, status: job.status, verdict: job.verdict, last_step, progress: trace.length, updated_at: job.updated_at });
}
