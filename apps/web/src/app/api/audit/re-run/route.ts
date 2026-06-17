import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { triggerReRun } from '@/lib/re-run-pipeline';
import { requireJobToken } from '@/lib/job-token';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import type { VisionStatusRecord } from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

// 2026-06-17: Manual re-run trigger. The pipeline usually auto-fires when
// Vision OCR completes, but the client can also kick it off explicitly
// (e.g. after a manual variance review or to refresh the workbook on
// demand). Idempotent: a prior in-flight or terminal record with the
// same (trigger, pdf_sha256) is returned without re-firing.
//
// Body: { job_id, triggered_by?: string, use_vision_record?: boolean }
// Response: ReRunRecord. Clients poll /api/audit/re-run-status for progress.

export async function POST(req: Request): Promise<Response> {
  let body: {
    job_id?: string;
    triggered_by?: string;
  };
  try {
    body = await req.json();
  } catch {
    return err('INVALID_STATE', 'invalid json body');
  }
  const jobId = body.job_id;
  if (!jobId) return err('INVALID_STATE', 'job_id is required');

  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const tokenError = requireJobToken(req, job, body);
  if (tokenError) return tokenError;

  const vision = await STORE.getVisionStatus(jobId);
  if (!vision) {
    return err('INVALID_STATE', 'no Vision record on this job; nothing to re-run');
  }
  if (vision.vision_status !== 'done') {
    return err('INVALID_STATE', `vision_status is ${vision.vision_status ?? 'null'}; re-run requires vision_status=done`);
  }

  const result = await triggerReRun({
    jobId,
    triggeredBy: body.triggered_by ?? 'manual:re-run-route',
    trigger: 'manual',
    visionRecord: vision as VisionStatusRecord
  });
  return NextResponse.json({
    re_run: result.reRun,
    triggered: result.triggered
  });
}
