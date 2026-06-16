import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { withDeprecation } from '../deprecation';

// Client-direct upload token minter. The browser calls `upload()` from
// @vercel/blob/client, which POSTs here to mint a short-lived client token, then
// streams the file straight to Vercel Blob — bypassing the 4.5MB serverless
// request-body limit that blocks large invoices/PDFs on /api/files/ingest.
//
// Registration (job + source_file row) is done AFTER the upload resolves, by the
// browser calling /api/files/register with the returned blob URL. We do NOT rely
// on onUploadCompleted because that callback only fires for deployments Vercel can
// reach back (never localhost), so it is not a dependable registration path.

export const runtime = 'nodejs';

const ALLOWED_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/octet-stream', // some browsers send this for .xlsx; the register step re-derives type from extension
];

// Hard ceiling for client-direct uploads. Generous vs the 4.5MB function limit,
// but bounded so a token can't authorize an unbounded upload.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return withDeprecation(
      NextResponse.json({ code: 'INVALID_REQUEST', message: 'invalid JSON body' }, { status: 400 }),
      '/api/files/blob-upload',
    );
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
      // No-op: see header comment. Registration happens via /api/files/register.
      onUploadCompleted: async () => {},
    });
    return withDeprecation(NextResponse.json(json), '/api/files/blob-upload');
  } catch (e) {
    return withDeprecation(
      NextResponse.json(
        { code: 'STORAGE_AUTH_FAILED', message: (e as Error).message },
        { status: 400 },
      ),
      '/api/files/blob-upload',
    );
  }
}
