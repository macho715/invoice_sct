import { describe, it, expect, vi } from 'vitest';

process.env.BLOB_READ_WRITE_TOKEN = 'mock-prod-token';

const putMock = vi.fn(async (_name: string, body?: Blob) => ({ url: `https://blob.vercel-storage.com/${body?.size ?? 0}`, pathname: 'inv.xlsx' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

import { POST } from '../src/app/api/files/ingest/route';

function makeRequest(file: File | null, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers });
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
});
