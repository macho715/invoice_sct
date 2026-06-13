import { describe, it, expect, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { GET as RESULT_GET } from '../src/app/api/audit/result/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';

describe('GET /api/audit/result', () => {
  it('JOB_NOT_FOUND', async () => {
    const r = await RESULT_GET(new Request('http://test/api/audit/result?job_id=job_nope'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('result not ready when none stored', async () => {
    const fd = new FormData();
    fd.set('file', new File(['x'], 'a.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const r1 = await INGEST_POST(new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } }));
    const { job_id } = await r1.json();
    const r = await RESULT_GET(new Request(`http://test/api/audit/result?job_id=${job_id}`));
    expect(r.status).toBe(409);
  });
});
