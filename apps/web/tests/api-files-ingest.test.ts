import { describe, it, expect, vi } from 'vitest';

process.env.BLOB_READ_WRITE_TOKEN = 'mock-prod-token';

const putMock = vi.fn(async (_name: string, body?: Blob) => ({ url: `https://blob.vercel-storage.com/${body?.size ?? 0}`, pathname: 'inv.xlsx' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

import { POST } from '../src/app/api/files/ingest/route';
import { STORE } from '../src/lib/job-store';

function makeRequest(file: File | null, headers: Record<string, string> = { 'x-user-id': 'u1' }, jobId?: string) {
  const fd = new FormData();
  if (file) fd.set('file', file);
  if (jobId) fd.set('job_id', jobId);
  return new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers });
}

function xlsx(name: string) {
  return new File(['hello'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('POST /api/files/ingest', () => {
  it('NO_FILE when no file in form', async () => {
    const r = await POST(makeRequest(null));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('NO_FILE');
  });

  it('pdf upload accepted (P3B) -> 201', async () => {
    // Plan §5.1 #6: positive pdf case after ingest allowlist change
    const f = new File(['%PDF-1.4 minimal'], 'inv.pdf', { type: 'application/pdf' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.job_id).toMatch(/^job_/);
    expect(body.file_ids).toHaveLength(1);
    expect(body.status).toBe('UPLOADED');
  });

  it('happy path: xlsx -> 201 with job_id, file_id, sha256, blob_ref', async () => {
    putMock.mockClear(); // hygiene after preceding pdf test (which also calls put)
    const f = new File(['hello'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.job_id).toMatch(/^job_/);
    expect(body.file_ids).toHaveLength(1);
    expect(body.status).toBe('UPLOADED');
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.blob_ref).toMatch(/^blob:/);
    expect(putMock).toHaveBeenCalled();
  });

  it('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD for > 4.5MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    const f = new File([big], 'big.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(413);
    expect((await r.json()).code).toBe('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD');
  });

  it('job_id append: second file attaches to the same job (multi-file upload)', async () => {
    const r1 = await POST(makeRequest(xlsx('invoice.xlsx')));
    const b1 = await r1.json();
    expect(r1.status).toBe(201);
    const jobId = b1.job_id;

    const r2 = await POST(makeRequest(xlsx('evidence.pdf'), { 'x-user-id': 'u1' }, jobId));
    const b2 = await r2.json();
    expect(r2.status).toBe(201);
    expect(b2.job_id).toBe(jobId); // same job, not a new one

    const files = await STORE.listSourceFiles(jobId);
    expect(files).toHaveLength(2);
  });

  it('JOB_NOT_FOUND when appending to an unknown job_id', async () => {
    const r = await POST(makeRequest(xlsx('x.xlsx'), { 'x-user-id': 'u1' }, 'job_does_not_exist'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });
});
