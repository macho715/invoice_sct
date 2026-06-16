import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { POST } from '../src/app/api/invoices/route';
import { STORE } from '../src/lib/job-store';
import { createJobToken } from '../src/lib/job-token';

const BLOB_URL = 'https://abc123.public.blob.vercel-storage.com/jobX/file-Ab12.pdf';
const BYTES = new TextEncoder().encode('registered blob bytes');
const SHA = 'ac8c2b7522a395551f162b5ed9880830ab5906789a4fb902ff45c67f92730a18';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function reg(body: unknown, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  return new Request('http://test/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/invoices (client-direct register)', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => BYTES.buffer.slice(BYTES.byteOffset, BYTES.byteOffset + BYTES.byteLength) });
  });

  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.ENFORCE_JOB_TOKEN_IN_TESTS;
  });

  it('rejects a non-Vercel-Blob url', async () => {
    const r = await POST(reg({ blob_url: 'https://evil.example.com/x.pdf', filename: 'x.pdf', size_bytes: 10, sha256: SHA }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('requires filename', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, size_bytes: 10, sha256: SHA }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('requires valid sha256', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'x.pdf', size_bytes: 10 }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('rejects unsupported file type', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL.replace('.pdf', '.exe'), filename: 'x.exe', content_type: '', size_bytes: 10, sha256: SHA }));
    expect((await r.json()).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('happy path: pdf -> 201 with puburl blob_ref', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: SHA }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.job_id).toMatch(/^job_/);
    expect(body.job_token).toEqual(expect.any(String));
    expect(body.file_ids).toHaveLength(1);
    expect(body.status).toBe('UPLOADED');
    expect(body.blob_ref).toBe(`puburl:${BLOB_URL}`);

    const sources = await STORE.listSourceFiles(body.job_id);
    expect(sources).toHaveLength(1);
    expect(sources[0].blob_ref).toBe(`puburl:${BLOB_URL}`);
  });

  it('appends to an existing job_id', async () => {
    const first = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: SHA }));
    const { job_id, job_token } = await first.json();
    const second = await POST(reg({ blob_url: BLOB_URL.replace('file-Ab12', 'file-Cd34'), filename: 'b.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size_bytes: BYTES.byteLength, sha256: SHA, job_id, job_token }));
    expect(second.status).toBe(201);
    expect((await second.json()).job_id).toBe(job_id);
    const sources = await STORE.listSourceFiles(job_id);
    expect(sources.length).toBe(2);
  });

  it('JOB_NOT_FOUND for unknown job_id', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: SHA, job_id: 'job_doesnotexist' }));
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('rejects a declared hash that does not match the fetched blob bytes', async () => {
    const r = await POST(reg({ blob_url: BLOB_URL, filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: 'a'.repeat(64) }));
    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('requires job_token when appending to an existing job in enforced mode', async () => {
    process.env.ENFORCE_JOB_TOKEN_IN_TESTS = '1';
    const job = await STORE.createJob({ created_by: 'u1' });
    await STORE.updateJob(job.job_id, { status: 'UPLOADED' });

    const missing = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: SHA, job_id: job.job_id }));
    expect(missing.status).toBe(403);

    const ok = await POST(reg({ blob_url: BLOB_URL, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: BYTES.byteLength, sha256: SHA, job_id: job.job_id, job_token: createJobToken(job) }));
    expect(ok.status).toBe(201);
  });

  it('accepts xlsx via extension fallback (no content-type)', async () => {
    const xlsxBlobUrl = BLOB_URL.replace('.pdf', '.xlsx');
    const r = await POST(reg({ blob_url: xlsxBlobUrl, filename: 'invoice.xlsx', content_type: '', size_bytes: BYTES.byteLength, sha256: SHA }));
    expect(r.status).toBe(201);
    const sources = await STORE.listSourceFiles((await r.json()).job_id);
    expect(sources[0].file_type).toBe('xlsx');
  });
});
