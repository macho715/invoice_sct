import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadOptions } from '@vercel/blob/client';
import { createJobStore, STORE } from '@/lib/job-store';
import { SourceFileSchema } from '@/lib/types';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
void createJobStore;

const LARGE_FILE_THRESHOLD_BYTES = 4_500_000;
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
const PENDING_SHA256_PLACEHOLDER = '0'.repeat(64);

interface LargeUploadRequest {
  filename: string;
  mimeType: string;
  fileSize: number;
  jobId: string;
}

function isLargeUploadRequest(value: unknown): value is LargeUploadRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.filename === 'string' &&
    typeof v.mimeType === 'string' &&
    typeof v.fileSize === 'number' &&
    typeof v.jobId === 'string'
  );
}

function mimeToFileType(mime: string): 'xlsx' | 'pdf' | 'image' | 'unknown' {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mime === 'image/jpeg' || mime === 'image/png') return 'image';
  return 'unknown';
}

function badRequest(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  // Read raw body once; handleUpload re-reads it for signature verification on
  // the blob.upload-completed callback event.
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return badRequest('invalid_json', 'request body must be valid JSON');
  }
  if (!isLargeUploadRequest(body)) {
    return badRequest('invalid_body', 'required fields: filename, mimeType, fileSize, jobId');
  }
  const { filename, mimeType, fileSize, jobId } = body;

  // 1) Threshold gate: too small => redirect to small-file route
  if (fileSize <= LARGE_FILE_THRESHOLD_BYTES) {
    return badRequest(
      'use_small_upload_route',
      `fileSize (${fileSize}) <= 4.5MB; use /api/files/ingest for small uploads`
    );
  }

  // 2) MIME allowlist gate
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return badRequest('unsupported_mime_type', `mimeType ${mimeType} not in allowlist`);
  }

  const userId = req.headers.get('x-user-id') ?? 'anonymous';

  // 3) Delegate to @vercel/blob/client handleUpload.
  //    The route handles two event types from the Vercel Blob client:
  //      - 'blob.generate-client-token': issues a short-lived client token after
  //        server-side auth + content-type / size validation.
  //      - 'blob.upload-completed': Vercel Blob calls this URL after the browser
  //        PUT succeeds, with an HMAC signature. We persist the source file row
  //        and append a UPLOAD trace.
  const uploadOptions: HandleUploadOptions = {
    body: JSON.parse(rawBody) as unknown as HandleUploadOptions['body'],
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      // Server-side path validation: only allow private/ scope per user.
      if (!pathname.startsWith(`private/${userId}/`)) {
        throw new Error(`forbidden pathname: ${pathname}`);
      }
      return {
        allowedContentTypes: Array.from(ALLOWED_MIME_TYPES),
        maximumSizeInBytes: 50 * 1024 * 1024,  // 50MB hard cap for large uploads
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ jobId, type: 'large', userId, filename })
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      // DB persistence will be wired when Postgres/Neon is integrated (P0-6).
      // For now, log so the upload flow is observable end-to-end.
      let parsedPayload: { jobId?: string; userId?: string; filename?: string } = {};
      try {
        parsedPayload = tokenPayload ? JSON.parse(tokenPayload) : {};
      } catch {
        // ignore malformed payload, default to empty
      }
      const resolvedJobId = parsedPayload.jobId ?? jobId;
      const resolvedUserId = parsedPayload.userId ?? userId;
      const resolvedFilename = parsedPayload.filename ?? filename;
      const resolvedMime = blob.contentType || mimeType;

      try {
        const sourceFile = SourceFileSchema.parse({
          file_id: `file_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          job_id: resolvedJobId,
          original_filename: resolvedFilename,
          file_type: mimeToFileType(resolvedMime),
          mime_type: resolvedMime,
          size_bytes: fileSize,
          sha256: PENDING_SHA256_PLACEHOLDER,  // P0-6: re-hashed on parse
          blob_ref: `blob:${blob.pathname}`,
          parser_status: 'PENDING',
          uploaded_by: resolvedUserId,
          uploaded_at: new Date().toISOString()
        });
        await STORE.addSourceFile(resolvedJobId, {
          ...sourceFile,
          blob_url: blob.url
        } as typeof sourceFile & { blob_url: string });
        await STORE.updateJob(resolvedJobId, { status: 'UPLOADED' });
        await STORE.appendTrace(resolvedJobId, {
          step: 'UPLOAD',
          input_ref: sourceFile.blob_ref,
          output_ref: resolvedJobId,
          source_hash: PENDING_SHA256_PLACEHOLDER
        });
      } catch (err) {
        // Persistence deferred until P0-6 (Postgres/Neon) lands; observable log only.
        // eslint-disable-next-line no-console
        console.warn('[files/ingest/large] persistence deferred (DB not integrated):', (err as Error).message);
      }
    }
  };

  try {
    const result = await handleUpload(uploadOptions);
    if (result.type === 'blob.generate-client-token') {
      return NextResponse.json(
        {
          url: result.clientToken,
          pathname: 'pending-on-client-upload',
          access: 'private' as const
        },
        { status: 200 }
      );
    }
    // blob.upload-completed event: acknowledge with 200
    return NextResponse.json(
      { url: null, pathname: 'completed', access: 'private' as const, response: result.response },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'handle_upload_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
