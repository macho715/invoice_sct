import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Encode each path segment but preserve '/' so the dev-blob catch-all route
// ([...path]) receives proper segments. encodeURIComponent on the whole path
// turns '/' into '%2F', which breaks Next.js catch-all parsing (500 on fetch).
function encodeBlobPath(filename: string): string {
  return filename.split('/').map(encodeURIComponent).join('/');
}

export interface BlobUploadResult {
  blob_ref: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  blob_url: string;
}

const DEV_LOCAL_BLOB_DIR = join(process.cwd(), '.dev-blob');
const BLOB_ACCESS_VALUES = ['private', 'public'] as const;
type BlobAccess = (typeof BLOB_ACCESS_VALUES)[number];

function isDevStubToken(): boolean {
  const t = process.env.BLOB_READ_WRITE_TOKEN ?? '';
  if (t !== '' && !t.startsWith('dev-stub')) return false;
  if (process.env.VERCEL === '1') {
    throw new Error(
      'STORAGE_AUTH_FAILED: BLOB_READ_WRITE_TOKEN is required in Vercel deployment. ' +
      'Set it in Vercel Dashboard -> Project -> Settings -> Environment Variables.'
    );
  }
  return true;
}

export async function uploadToBlob(file: File, jobId: string): Promise<BlobUploadResult> {
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}`.toLowerCase() : '';
  const filename = `${jobId}/${id}${ext}`;

  if (isDevStubToken()) {
    const target = join(DEV_LOCAL_BLOB_DIR, filename);
    mkdirSync(join(DEV_LOCAL_BLOB_DIR, jobId), { recursive: true });
    writeFileSync(target, buf);
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
    return {
      blob_ref: `local:${filename}`,
      sha256,
      size_bytes: buf.byteLength,
      mime_type: file.type || 'application/octet-stream',
      blob_url: `${base}/api/dev/blob/${encodeBlobPath(filename)}`
    };
  }

  const { put } = await import('@vercel/blob');
  const access = resolveBlobAccess();
  const res = await put(filename, file, { access, addRandomSuffix: true });
  return {
    blob_ref: `blob:${res.pathname}`,
    sha256,
    size_bytes: buf.byteLength,
    mime_type: file.type || 'application/octet-stream',
    blob_url: res.url
  };
}

function resolveBlobAccess(): BlobAccess {
  const access = (process.env.BLOB_ACCESS ?? 'private').trim();
  if (BLOB_ACCESS_VALUES.includes(access as BlobAccess)) {
    return access as BlobAccess;
  }
  throw new Error(`STORAGE_AUTH_FAILED: BLOB_ACCESS must be "private" or "public", got "${access}"`);
}

export async function getSignedDownloadUrl(blobRef: string): Promise<string> {
  // Public client-direct uploads (>4.5MB path via @vercel/blob/client) are stored
  // as `puburl:<url>`. The blob is public, so the URL is directly fetchable — no
  // presign needed, and this works regardless of the BLOB_ACCESS setting.
  if (blobRef.startsWith('puburl:')) {
    return blobRef.slice('puburl:'.length);
  }

  if (blobRef.startsWith('local:')) {
    const filename = blobRef.slice('local:'.length);
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
    return `${base}/api/dev/blob/${encodeBlobPath(filename)}`;
  }

  if (blobRef.startsWith('blob:')) {
    const pathname = blobRef.slice('blob:'.length);
    const { issueSignedToken, presignUrl } = await import('@vercel/blob');
    const access = resolveBlobAccess();
    const token = await issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil: Date.now() + 15 * 60 * 1000,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname,
      access,
    });
    return presignedUrl;
  }

  throw new Error(`Unknown blob_ref scheme: ${blobRef}`);
}

export async function streamFromBlob(blobRef: string): Promise<Buffer> {
  if (blobRef.startsWith('puburl:')) {
    const url = blobRef.slice('puburl:'.length);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download blob: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (blobRef.startsWith('local:')) {
    const filename = blobRef.slice('local:'.length);
    const target = join(DEV_LOCAL_BLOB_DIR, filename);
    if (!existsSync(target)) {
      throw new Error(`Local blob not found: ${target}`);
    }
    return Buffer.from(readFileSync(target));
  }

  if (blobRef.startsWith('blob:')) {
    const signedUrl = await getSignedDownloadUrl(blobRef);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download blob: ${response.status} ${response.statusText}`);
    }
    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  throw new Error(`Unknown blob_ref scheme: ${blobRef}`);
}
