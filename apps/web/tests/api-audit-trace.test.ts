import { describe, it, expect, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { GET as TRACE_GET } from '../src/app/api/audit/trace/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';

describe('GET /api/audit/trace', () => {
  it('JOB_NOT_FOUND', async () => {
    const r = await TRACE_GET(new Request('http://test/api/audit/trace?job_id=job_nope'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('trace is initially empty list', async () => {
    const fd = new FormData();
    fd.set('file', new File(['x'], 'a.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const r1 = await INGEST_POST(new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } }));
    const { job_id } = await r1.json();
    const r = await TRACE_GET(new Request(`http://test/api/audit/trace?job_id=${job_id}`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.job_id).toBe(job_id);
    expect(Array.isArray(body.trace)).toBe(true);
    expect(body.trace.length).toBe(1);
    expect(body.trace[0].step).toBe('UPLOAD');
  });
});
