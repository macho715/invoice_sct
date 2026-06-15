import { describe, it, expect } from 'vitest';
import { POST } from '../src/app/api/files/register/route';
import { STORE } from '../src/lib/job-store';

const BLOB_URL = 'https://abc123.public.blob.vercel-storage.com/jobX/file-Ab12.pdf';
const SHA = 'a'.repeat(64);

function reg(body: unknown, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  return new Request('http://test/api/files/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/files/register (client-direct upload)', () => {
  it('rejects a non-Vercel-Blob url', async () => {
    const r = await POST(reg({ blob_url: 'https://evil.example.com/x.pdf', filename: 'x.pdf', size_bytes: 10 }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('requires filename', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, size_bytes: 10 }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('rejects unsupported file type', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL.replace('.pdf', '.exe'), filename: 'x.exe', content_type: '', size_bytes: 10 }));
    expect((await r.json()).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('happy path: pdf -> 201 with puburl blob_ref', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: 9_000_000, sha256: SHA }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.job_id).toMatch(/^job_/);
    expect(body.file_ids).toHaveLength(1);
    expect(body.status).toBe('UPLOADED');
    expect(body.blob_ref).toBe(`puburl:${BLOB_URL}`);

    const sources = await STORE.listSourceFiles(body.job_id);
    expect(sources).toHaveLength(1);
    expect(sources[0].blob_ref).toBe(`puburl:${BLOB_URL}`);
  });

  it('appends to an existing job_id', async () => {
    const first = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 5_000_000, sha256: SHA }));
    const { job_id } = await first.json();
    const second = await POST(reg({ blob_url: BLOB_URL.replace('file-Ab12', 'file-Cd34'), filename: 'b.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size_bytes: 6_000_000, sha256: SHA, job_id }));
    expect(second.status).toBe(201);
    expect((await second.json()).job_id).toBe(job_id);
    const sources = await STORE.listSourceFiles(job_id);
    expect(sources.length).toBe(2);
  });

  it('JOB_NOT_FOUND for unknown job_id', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 5_000_000, sha256: SHA, job_id: 'job_doesnotexist' }));
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });
});
