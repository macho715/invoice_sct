import { NextResponse } from 'next/server';
import { uploadToBlob } from '@/lib/blob';
import { createJobStore, STORE } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';
import { randomUUID } from 'node:crypto';

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
  return NextResponse.json({ code, message, ...extra }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
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
  let blobRes;
  try { blobRes = await uploadToBlob(file, 'pending'); } catch (e) { return err('STORAGE_AUTH_FAILED', (e as Error).message); }
  const job = await STORE.createJob({ created_by: userId });
  const sourceFile = SourceFileSchema.parse({
    file_id: `file_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    job_id: job.job_id,
    original_filename: file.name,
    file_type, mime_type: file.type || 'application/octet-stream',
    size_bytes: blobRes.size_bytes, sha256: blobRes.sha256, blob_ref: blobRes.blob_ref,
    parser_status: 'PENDING', uploaded_by: userId, uploaded_at: new Date().toISOString()
  });
  await STORE.addSourceFile(job.job_id, { ...sourceFile, blob_url: blobRes.blob_url } as typeof sourceFile & { blob_url: string });
  await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
  await STORE.appendTrace(job.job_id, { step: 'UPLOAD', input_ref: sourceFile.blob_ref, output_ref: job.job_id, source_hash: blobRes.sha256 });
  return NextResponse.json({ job_id: job.job_id, file_ids: [sourceFile.file_id], status: 'UPLOADED', sha256: blobRes.sha256, blob_ref: blobRes.blob_ref }, { status: 201 });
}
