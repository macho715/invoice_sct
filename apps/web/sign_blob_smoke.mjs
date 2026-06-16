// Sign private Vercel Blob URL and fire /v1/notebooklm/run smoke test
// DLP-safe: prints only hashes/status, never raw URL/token/content
import { issueSignedToken, presignUrl } from '@vercel/blob';
import { createHash } from 'node:crypto';

const PATHNAME = 'smoke-test/markitdown_smoke_1781524733616.pdf';
const WORKER_URL = 'http://localhost:8000/v1/notebooklm/run';
const JOB_ID = `smoke_${Date.now()}`;
const BLOB_ACCESS = process.env.BLOB_ACCESS ?? 'private';

console.log('[smoke] job_id:', JOB_ID);
console.log('[smoke] blob_access:', BLOB_ACCESS);

// Step 1: issue signed token
const token = await issueSignedToken({
  pathname: PATHNAME,
  operations: ['get'],
  validUntil: Date.now() + 15 * 60 * 1000,
});
const tokenStr = typeof token === 'string' ? token : JSON.stringify(token);
const tokenHash = createHash('sha256').update(tokenStr).digest('hex').slice(0, 16);
console.log('[smoke] signed_token_type:', typeof token);
console.log('[smoke] signed_token_sha256_prefix:', tokenHash);

// Step 2: presign URL
const { presignedUrl } = await presignUrl(token, {
  operation: 'get',
  pathname: PATHNAME,
  access: BLOB_ACCESS,
});
const urlHash = createHash('sha256').update(presignedUrl).digest('hex').slice(0, 16);
console.log('[smoke] presigned_url_sha256_prefix:', urlHash);
console.log('[smoke] presigned_url_hostname:', new URL(presignedUrl).hostname);

// Step 3: POST to worker
console.log('[smoke] POSTing to', WORKER_URL, '...');
const res = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ job_id: JOB_ID, blob_url: presignedUrl }),
});

console.log('[smoke] HTTP status:', res.status);
const body = await res.json();

// Print only DLP-safe metadata
console.log('[smoke] result.status:', body.status);
console.log('[smoke] result.error_code:', body.error_code ?? null);
console.log('[smoke] result.markdown_sha256:', body.markdown_sha256 ?? null);
console.log('[smoke] result.source_sha256:', body.source_sha256 ?? null);
console.log('[smoke] done');
