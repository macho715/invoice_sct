import { NextResponse } from 'next/server';
import { uploadToBlob } from '@/lib/blob';
import { createJobStore, STORE } from '@/lib/job-store';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';
import { randomUUID } from 'node:crypto';
import { createJobToken, requireJobToken } from '@/lib/job-token';
import { withDeprecation } from '../deprecation';

export const runtime = 'nodejs';
void createJobStore;

const MAX_DIRECT_UPLOAD_BYTES = 4_500_000;
const ALLOWED_MIME: Record<string, 'xlsx' | 'md' | 'txt' | 'pdf'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/pdf': 'pdf'  // P3B
};
const ALLOWED_EXT: Record<string, 'xlsx' | 'md' | 'txt' | 'pdf'> = {
  '.xlsx': 'xlsx', '.md': 'md', '.txt': 'txt', '.pdf': 'pdf'  // P3B
};

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return withDeprecation(
    NextResponse.json({ code, message, ...extra }, { status: httpForError(code) }),
    '/api/files/ingest',
  );
}

// Structured error log per Google Cloud Logging / Cloud Run convention.
// See https://docs.cloud.google.com/run/docs/samples/cloudrun-manual-logging —
// Vercel Functions picks up the JSON shape and surfaces severity in the dashboard.
function logIngestFailure(stage: string, e: unknown, extra: Record<string, unknown> = {}): void {
  const err = e as { name?: string; message?: string; stack?: string; code?: string };
  console.error(JSON.stringify({
    severity: 'ERROR',
    message: `[files/ingest] ${stage} failed`,
    component: 'files/ingest',
    stage,
    error_name: err?.name ?? 'Error',
    error_message: err?.message ?? String(e),
    error_code: err?.code,
    error_stack: err?.stack?.split('\n').slice(0, 5).join('\n'),
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await ingestFile(req);
  } catch (e) {
    logIngestFailure('unhandled', e);
    return err('STORAGE_AUTH_FAILED', `ingest failed: ${(e as Error)?.message ?? 'unknown'}`);
  }
}

async function ingestFile(req: Request): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch { return err('STORAGE_AUTH_FAILED', 'invalid form body'); }
  const file = form.get('file');
  if (!file || !(file instanceof File)) return err('NO_FILE', 'no file in form data');
  if (file.size === 0) return err('UNSUPPORTED_FILE_TYPE', 'zero-byte file');
  const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase();
  const file_type = ALLOWED_MIME[file.type] ?? ALLOWED_EXT[ext];
  if (!file_type) return err('UNSUPPORTED_FILE_TYPE', `unsupported file type: ${file.type || ext}`);
  if (file.size > MAX_DIRECT_UPLOAD_BYTES) return err('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD', 'file exceeds 4.5MB; use client direct upload', { max_bytes: MAX_DIRECT_UPLOAD_BYTES });
  const userId = req.headers.get('x-user-id') ?? 'anonymous';

  // Optional job_id: append this file to an existing job (multi-file upload).
  // Without it, a new job is created (single-file / first-file behavior).
  const jobIdRaw = form.get('job_id');
  const jobId = typeof jobIdRaw === 'string' && jobIdRaw.trim() ? jobIdRaw.trim() : null;
  const workflowTypeRaw = form.get('workflow_type');
  const workflowType = (typeof workflowTypeRaw === 'string' && (workflowTypeRaw === 'SHIPMENT' || workflowTypeRaw === 'DOMESTIC')) ? workflowTypeRaw : 'SHIPMENT';
  let job;
  if (jobId) {
    const existing = await STORE.getJob(jobId);
    if (!existing) return err('JOB_NOT_FOUND', 'unknown job_id');
    const tokenError = requireJobToken(req, existing, form);
    if (tokenError) return tokenError;
    if (existing.status !== 'UPLOADED' && existing.status !== 'QUEUED') {
      return err('INVALID_STATE', `cannot add files to job in status ${existing.status}`);
    }
    job = existing;
  } else {
    job = await STORE.createJob({ created_by: userId, workflow_type: workflowType as 'SHIPMENT' | 'DOMESTIC' });
  }

  let blobRes;
  try { blobRes = await uploadToBlob(file, job.job_id); } catch (e) {
    logIngestFailure('uploadToBlob', e, { job_id: job.job_id, filename: file.name, size_bytes: file.size });
    return err('STORAGE_AUTH_FAILED', (e as Error).message);
  }

  let sourceFile;
  try {
    sourceFile = SourceFileSchema.parse({
      file_id: `file_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      job_id: job.job_id,
      original_filename: file.name,
      file_type, mime_type: file.type || 'application/octet-stream',
      size_bytes: blobRes.size_bytes, sha256: blobRes.sha256, blob_ref: blobRes.blob_ref,
      parser_status: 'PENDING', uploaded_by: userId, uploaded_at: new Date().toISOString()
    });
  } catch (e) {
    logIngestFailure('SourceFileSchema.parse', e, { job_id: job.job_id });
    return err('INVALID_REQUEST', `source_file schema parse failed: ${(e as Error).message}`);
  }

  try {
    await STORE.addSourceFile(job.job_id, { ...sourceFile, blob_url: blobRes.blob_url } as typeof sourceFile & { blob_url: string });
    await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
    await STORE.appendTrace(job.job_id, { step: 'UPLOAD', input_ref: sourceFile.blob_ref, output_ref: job.job_id, source_hash: blobRes.sha256 });
  } catch (e) {
    // STORAGE_AUTH_FAILED covers both Blob credential issues and Postgres/Neon
    // connection failures. The real cause (Neon cold start, ECONNRESET, missing
    // DATABASE_URL, etc.) is now in the structured log so Vercel dashboards can
    // surface it via `component:"files/ingest" stage:"STORE"`.
    logIngestFailure('STORE', e, { job_id: job.job_id, file_id: sourceFile.file_id });
    return err('STORAGE_AUTH_FAILED', `job store write failed: ${(e as Error).message ?? 'unknown'}`);
  }
  return withDeprecation(
    NextResponse.json({ job_id: job.job_id, job_token: createJobToken(job), file_ids: [sourceFile.file_id], status: 'UPLOADED', sha256: blobRes.sha256, blob_ref: blobRes.blob_ref }, { status: 201 }),
    '/api/files/ingest',
  );
}
