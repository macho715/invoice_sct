import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';
import { randomUUID } from 'node:crypto';

// Register a file that the browser already streamed straight to Vercel Blob via
// the client-direct upload path (/api/files/blob-upload). This is the >4.5MB
// counterpart to /api/files/ingest: same job + source_file bookkeeping, but the
// bytes never pass through this function, so there is no 4.5MB request-body wall.
//
// The uploaded blob is public (client `upload({ access: 'public' })`), so its URL
// is directly fetchable. We store it as a `puburl:` blob_ref, which
// getSignedDownloadUrl/streamFromBlob return verbatim — independent of BLOB_ACCESS.

export const runtime = 'nodejs';

const ALLOWED_MIME: Record<string, 'xlsx' | 'md' | 'txt' | 'pdf'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
};
const ALLOWED_EXT: Record<string, 'xlsx' | 'md' | 'txt' | 'pdf'> = {
  '.xlsx': 'xlsx', '.md': 'md', '.txt': 'txt', '.pdf': 'pdf',
};

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, message, ...extra }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleRegister(req);
  } catch (e) {
    console.error('[files/register] unhandled failure:', e);
    return err('STORAGE_AUTH_FAILED', 'register failed');
  }
}

async function handleRegister(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('INVALID_REQUEST', 'invalid JSON body'); }

  const blobUrl = typeof body.blob_url === 'string' ? body.blob_url.trim() : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const contentType = typeof body.content_type === 'string' ? body.content_type : '';
  const sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
  const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
  const jobIdIn = typeof body.job_id === 'string' && body.job_id.trim() ? body.job_id.trim() : null;

  if (!blobUrl || !/^https:\/\/[^ ]+\.(public\.)?blob\.vercel-storage\.com\//.test(blobUrl)) {
    return err('INVALID_REQUEST', 'valid Vercel Blob blob_url is required');
  }
  if (!filename) return err('INVALID_REQUEST', 'filename is required');
  if (sizeBytes <= 0) return err('UNSUPPORTED_FILE_TYPE', 'size_bytes must be > 0');

  const ext = ('.' + (filename.split('.').pop() ?? '')).toLowerCase();
  const fileType = ALLOWED_MIME[contentType] ?? ALLOWED_EXT[ext];
  if (!fileType) return err('UNSUPPORTED_FILE_TYPE', `unsupported file type: ${contentType || ext}`);

  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    return err('INVALID_REQUEST', 'valid sha256 (64 hex chars) is required');
  }

  const userId = req.headers.get('x-user-id') ?? 'anonymous';

  let job;
  if (jobIdIn) {
    const existing = await STORE.getJob(jobIdIn);
    if (!existing) return err('JOB_NOT_FOUND', 'unknown job_id');
    if (existing.status !== 'UPLOADED' && existing.status !== 'QUEUED') {
      return err('INVALID_STATE', `cannot add files to job in status ${existing.status}`);
    }
    job = existing;
  } else {
    job = await STORE.createJob({ created_by: userId });
  }

  const sourceFile = SourceFileSchema.parse({
    file_id: `file_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    job_id: job.job_id,
    original_filename: filename,
    file_type: fileType,
    mime_type: contentType || 'application/octet-stream',
    size_bytes: sizeBytes,
    sha256,
    blob_ref: `puburl:${blobUrl}`,
    parser_status: 'PENDING',
    uploaded_by: userId,
    uploaded_at: new Date().toISOString(),
  });
  await STORE.addSourceFile(job.job_id, { ...sourceFile, blob_url: blobUrl } as typeof sourceFile & { blob_url: string });
  await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
  await STORE.appendTrace(job.job_id, { step: 'UPLOAD', input_ref: sourceFile.blob_ref, output_ref: job.job_id, source_hash: sourceFile.sha256 });

  return NextResponse.json(
    { job_id: job.job_id, file_ids: [sourceFile.file_id], status: 'UPLOADED', blob_ref: sourceFile.blob_ref },
    { status: 201 },
  );
}
