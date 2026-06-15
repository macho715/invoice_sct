import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, message, ...extra }, { status: httpForError(code) });
}

export async function POST(req: NextRequest) {
  try {
    return await handleCreateUploadUrl(req);
  } catch (e) {
    console.error('[files/create-upload-url] unhandled failure:', e);
    return err('STORAGE_AUTH_FAILED', 'failed to create upload URL');
  }
}

async function handleCreateUploadUrl(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('INVALID_REQUEST', 'invalid JSON body'); }

  const { filename, mime_type, size_bytes, file_role } = body as {
    filename?: string;
    mime_type?: string;
    size_bytes?: number;
    file_role?: 'INVOICE' | 'EVIDENCE' | 'UNKNOWN';
  };

  if (!filename || !mime_type) {
    return err('INVALID_REQUEST', 'filename and mime_type are required');
  }

  // Dev stub: return local upload URL
  const jobId = `job_${Date.now().toString(36)}`;
  const fileId = `file_${Math.random().toString(36).slice(2, 10)}`;

  // In production, use GCS signed URL generation via @google-cloud/storage
  // For now, return a dev-local ingestion reference
  const gcsUri = `gs://hvdc-invoice-source-prod/source/${jobId}/${fileId}/${filename}`;
  const signedUploadUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/files/ingest`;

  return NextResponse.json(
    {
      job_id: jobId,
      file_id: fileId,
      gcs_uri: gcsUri,
      signed_upload_url: signedUploadUrl,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      file_role: file_role || 'INVOICE',
    },
    { status: 201 },
  );
}
