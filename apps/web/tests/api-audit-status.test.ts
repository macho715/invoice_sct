import { describe, it, expect, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { GET as STATUS_GET } from '../src/app/api/audit/status/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';

async function setupJob(): Promise<string> {
  const fd = new FormData();
  fd.set('file', new File(['x'], 'a.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const r = await INGEST_POST(new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } }));
  const j = await r.json();
  return j.job_id;
}

describe('GET /api/audit/status', () => {
  it('JOB_NOT_FOUND', async () => {
    const r = await STATUS_GET(new Request('http://test/api/audit/status?job_id=job_nope'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('happy path', async () => {
    const jobId = await setupJob();
    const r = await STATUS_GET(new Request(`http://test/api/audit/status?job_id=${jobId}`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.job_id).toBe(jobId);
    expect(body.status).toBe('UPLOADED');
    expect(body.last_step).toBe('UPLOAD');
  });
});
