import { NextRequest, NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { createJobToken } from '@/lib/job-token';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';
import { withDeprecation } from '../deprecation';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return withDeprecation(
    NextResponse.json({ code, message, ...extra }, { status: httpForError(code) }),
    '/api/files/confirm',
  );
}

export async function POST(req: NextRequest) {
  try {
    return await handleConfirm(req);
  } catch (e) {
    console.error('[files/confirm] unhandled failure:', e);
    return err('STORAGE_AUTH_FAILED', 'confirm failed');
  }
}

async function handleConfirm(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('INVALID_REQUEST', 'invalid JSON body'); }

  const { job_id, file_id, sha256, size_bytes, gcs_uri } = body as {
    job_id?: string;
    file_id?: string;
    sha256?: string;
    size_bytes?: number;
    gcs_uri?: string;
  };

  if (!job_id || !file_id || !sha256) {
    return err('INVALID_REQUEST', 'job_id, file_id, and sha256 are required');
  }

  const userId = req.headers.get('x-user-id') ?? 'anonymous';
  const resolvedGcsUri = gcs_uri || `gs://hvdc-invoice-source-prod/source/${job_id}/${file_id}/unknown`;
  const fileName = resolvedGcsUri.split('/').pop() ?? 'unknown';
  const fileType = resolvedGcsUri.endsWith('.pdf') ? 'pdf' as const : 'xlsx' as const;
  const mimeType = fileType === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const sourceFile = SourceFileSchema.parse({
    file_id,
    job_id,
    original_filename: fileName,
    file_type: fileType,
    mime_type: mimeType,
    size_bytes: size_bytes ?? 0,
    sha256,
    blob_ref: resolvedGcsUri,
    parser_status: 'PENDING',
    uploaded_by: userId,
    uploaded_at: new Date().toISOString(),
  });

  try {
    // Ensure job exists; create if missing
    let job = await STORE.getJob(job_id);
    if (!job) job = await STORE.createJob({ created_by: userId, job_id });

    await STORE.addSourceFile(job_id, sourceFile);
    await STORE.updateJob(job_id, { status: 'UPLOADED' });
    await STORE.appendTrace(job_id, {
      step: 'UPLOAD',
      input_ref: resolvedGcsUri,
      output_ref: job_id,
      source_hash: sha256,
    });

    return withDeprecation(
      NextResponse.json(
        {
          job_id,
          job_token: createJobToken(job),
          file_id,
          sha256,
          gcs_uri: resolvedGcsUri,
          status: 'UPLOADED',
        },
        { status: 200 },
      ),
      '/api/files/confirm',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CONFIRM_FAILED';
    return withDeprecation(
      NextResponse.json(
        { code: 'CONFIRM_FAILED' as ErrorCode, message, extra: {} },
        { status: httpForError('CONFIRM_FAILED') },
      ),
      '/api/files/confirm',
    );
  }
}
