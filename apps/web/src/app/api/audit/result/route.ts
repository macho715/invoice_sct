import { NextResponse } from 'next/server';
import { createJobStore, STORE } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import type { Verdict } from '@/lib/types';

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
  const result = await STORE.getResult(jobId);
  if (!result) return err('INVALID_STATE', 'result not ready');
  // P3C: include pdf_source_data when present (plan §6.1 #3, §6.4)
  const pdfSource = (result as any).pdf_source_data || (result as any).source_data_rows || [];
  return NextResponse.json({ job_id: job.job_id, verdict: result.verdict, line_results: result.line_results, action_items: result.action_items, pdf_source_data: pdfSource });
}

export async function POST(req: Request): Promise<Response> {
  let body: {
    job_id?: string;
    verdict?: Verdict;
    variance_aed?: number;
    line_results?: any[];
    action_items?: any[];
  };
  try {
    body = await req.json();
  } catch {
    return err('INVALID_STATE', 'invalid json body');
  }

  const jobId = body.job_id;
  const verdict = body.verdict;
  if (!jobId || !verdict) {
    return err('INVALID_STATE', 'job_id and verdict are required');
  }

  const existing = await STORE.getJob(jobId);
  if (!existing) {
    await STORE.createJob({ created_by: 'e2e-seed', job_id: jobId });
  }

  const normalizedLineResults = (body.line_results ?? []).map((line, index) => ({
    line_id: String(line.line_id ?? `line_${index + 1}`),
    verdict: (line.verdict ?? verdict) as Verdict,
    band: line.band ?? null,
    delta_pct: line.delta_pct ?? null,
    reason_codes: line.reason_codes ?? [],
  }));
  const normalizedActionItems = (body.action_items ?? []).map((item, index) => ({
    action_id: String(item.action_id ?? `act_${index + 1}`),
    severity: (item.severity ?? verdict) as Verdict,
    line_id: item.line_id ?? null,
    issue_type: String(item.issue_type ?? 'SEE_REVIEW'),
    required_action: String(item.required_action ?? 'Reviewer action required'),
  }));

  await STORE.setResult(jobId, {
    verdict,
    line_results: normalizedLineResults,
    action_items: normalizedActionItems,
    variance_aed: body.variance_aed ?? 0,
  } as any);
  await STORE.updateJob(jobId, { status: 'REVIEW_REQUIRED', verdict });

  return NextResponse.json({
    job_id: jobId,
    verdict,
    line_results: normalizedLineResults,
    action_items: normalizedActionItems,
    variance_aed: body.variance_aed ?? 0,
  }, { status: 201 });
}
