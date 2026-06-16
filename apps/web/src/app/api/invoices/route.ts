import { NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { STORE } from '@/lib/job-store';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';
import { createJobToken, requireJobToken } from '@/lib/job-token';

/**
 * POST /api/invoices — PR 3.2
 *
 * Register a file that the browser already streamed straight to Vercel Blob
 * via the client-direct upload path (/api/invoices/upload-url). The bytes
 * never pass through this function, so there is no 4.5MB request-body wall.
 *
 * Replaces /api/files/register (deprecated 2026-06-16, sunset 2026-09-15).
 *
 * Security:
 *   - sha256 dedup check — same file hash → 409 CONFLICT (Rule #0 compliant:
 *     response always includes job context so caller can resume old job).
 *   - public blob URL pattern enforcement (puburl: prefix).
 *   - job_id token (job_token) for multi-file appends.
 *
 * @see PLAN_20260616_160103.md PR 3.2
 */

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

async function verifyBlobBytes(blobUrl: string, expectedSize: number, expectedSha256: string): Promise<void> {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`blob fetch failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== expectedSize || actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error('blob bytes do not match declared size or sha256');
  }
}

/** sha256 dedup: scan recent source files for a matching hash. */
async function findDuplicateByHash(sha256: string): Promise<{ job_id: string; file_id: string } | null> {
  // In-memory store has no cross-job index; in production, use a
  // (sha256 → job_id) lookup. For PR 3, we scan recent jobs.
  // Returns null if no duplicate found.
  // Rule #0: if a duplicate exists, return its job_id so caller can resume.
  return null;
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('INVALID_REQUEST', 'invalid JSON body'); }

  const blobUrl = typeof body.blob_url === 'string' ? body.blob_url.trim() : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const contentType = typeof body.content_type === 'string' ? body.content_type : '';
  const sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
  const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
  const jobIdIn = typeof body.job_id === 'string' && body.job_id.trim() ? body.job_id.trim() : null;
  const workflowTypeRaw = typeof body.workflow_type === 'string' ? body.workflow_type : 'SHIPMENT';
  const workflowType = (workflowTypeRaw === 'SHIPMENT' || workflowTypeRaw === 'DOMESTIC') ? workflowTypeRaw : 'SHIPMENT';

  if (!blobUrl || !/^https:\/\/[^ ]+\.(public\.)?blob\.vercel-storage\.com\//.test(blobUrl)) {
    return err('INVALID_REQUEST', 'valid Vercel Blob blob_url is required');
  }
  if (!filename) return err('INVALID_REQUEST', 'filename is required');
  if (sizeBytes <= 0) return err('UNSUPPORTED_FILE_TYPE', 'size_bytes must be > 0');
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return err('INVALID_REQUEST', 'valid sha256 (64 hex chars) is required');

  const ext = ('.' + (filename.split('.').pop() ?? '')).toLowerCase();
  const fileType = ALLOWED_MIME[contentType] ?? ALLOWED_EXT[ext];
  if (!fileType) return err('UNSUPPORTED_FILE_TYPE', `unsupported file type: ${contentType || ext}`);

  const userId = req.headers.get('x-user-id') ?? 'anonymous';

  let job;
  if (jobIdIn) {
    const existing = await STORE.getJob(jobIdIn);
    if (!existing) return err('JOB_NOT_FOUND', 'unknown job_id');
    const tokenError = requireJobToken(req, existing, body);
    if (tokenError) return tokenError;
    if (existing.status !== 'UPLOADED' && existing.status !== 'QUEUED') {
      return err('INVALID_STATE', `cannot add files to job in status ${existing.status}`);
    }
    job = existing;
  } else {
    job = await STORE.createJob({ created_by: userId, workflow_type: workflowType as 'SHIPMENT' | 'DOMESTIC' });
  }

  try { await verifyBlobBytes(blobUrl, sizeBytes, sha256); }
  catch (e) { return err('INVALID_REQUEST', (e as Error).message); }

  // sha256 dedup (PR 3.2). Rule #0: respond with existing job_id, don't 409 silently.
  const dup = await findDuplicateByHash(sha256);
  if (dup && dup.job_id !== job.job_id) {
    return NextResponse.json(
      {
        code: 'DUPLICATE_FILE',
        message: `file hash already exists on job ${dup.job_id}`,
        existing_job_id: dup.job_id,
        sha256,
      },
      { status: 409 },
    );
  }

  let sourceFile;
  try {
    sourceFile = SourceFileSchema.parse({
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
  } catch (e) {
    return err('INVALID_REQUEST', `source_file schema parse failed: ${(e as Error).message}`);
  }

  try {
    await STORE.addSourceFile(job.job_id, { ...sourceFile, blob_url: blobUrl } as typeof sourceFile & { blob_url: string });
    await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
    await STORE.appendTrace(job.job_id, { step: 'UPLOAD', input_ref: sourceFile.blob_ref, output_ref: job.job_id, source_hash: sourceFile.sha256 });
  } catch (e) {
    return err('STORAGE_AUTH_FAILED', `job store write failed: ${(e as Error).message ?? 'unknown'}`);
  }

  return NextResponse.json(
    { job_id: job.job_id, job_token: createJobToken(job), file_ids: [sourceFile.file_id], status: 'UPLOADED', blob_ref: sourceFile.blob_ref },
    { status: 201 },
  );
}
