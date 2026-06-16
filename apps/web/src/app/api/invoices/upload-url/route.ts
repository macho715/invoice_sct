import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

/**
 * POST /api/invoices/upload-url — PR 3.1
 *
 * Client-direct upload token minter. Browser calls `upload()` from
 * @vercel/blob/client → POST here to mint a short-lived token → file streams
 * straight to Vercel Blob (bypasses 4.5MB serverless request-body limit).
 *
 * Replaces /api/files/blob-upload (deprecated 2026-06-16, sunset 2026-09-15).
 * Registration (job + source_file row) is done by /api/invoices after upload
 * resolves — we do NOT rely on onUploadCompleted because that callback only
 * fires for deployments Vercel can reach back (never localhost).
 *
 * Security:
 *   - allowedContentTypes restricts to xlsx / md / txt / pdf
 *   - maximumSizeInBytes 50 MB hard ceiling
 *   - addRandomSuffix true (prevent object-name collisions)
 *
 * @see PLAN_20260616_160103.md PR 3
 * @see patch_g.md §"핵심 문제 4: Vercel Blob 사용은 좋아 보이나, 업로드 보안 단계가 약할 수 있음"
 */

export const runtime = 'nodejs';

const ALLOWED_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/octet-stream', // some browsers send this for .xlsx; the register step re-derives type from extension
];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
      // No-op: registration happens via /api/invoices (PR 3.2).
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { code: 'STORAGE_AUTH_FAILED', message: (e as Error).message },
      { status: 400 },
    );
  }
}
