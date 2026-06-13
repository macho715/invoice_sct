import { describe, it, expect, vi, afterEach } from 'vitest';
import { POST as EXPORT_POST } from '../src/app/api/audit/export/route';
import { STORE } from '../src/lib/job-store';

describe('POST /api/audit/export', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('JOB_NOT_FOUND', async () => {
    const res = await EXPORT_POST(
      new Request('http://test/api/audit/export', {
        method: 'POST',
        body: JSON.stringify({ job_id: 'job_nonexistent' })
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('APPROVAL_REQUIRED when AMBER job is not approved', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setResult(job.job_id, { verdict: 'AMBER', line_results: [], action_items: [] });

    const res = await EXPORT_POST(
      new Request('http://test/api/audit/export', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id })
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('APPROVAL_REQUIRED');
  });

  it('ZERO_BLOCKED when job verdict is ZERO', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'ZERO' });
    await STORE.setResult(job.job_id, { verdict: 'ZERO', line_results: [], action_items: [] });

    const res = await EXPORT_POST(
      new Request('http://test/api/audit/export', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id })
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ZERO_BLOCKED');
  });

  it('success export with mocked worker response', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'PASS' });
    await STORE.setResult(job.job_id, { verdict: 'PASS', line_results: [], action_items: [] });

    // Mock fetch to parser worker
    const mockWorkerRes = {
      job_id: job.job_id,
      manifest: {
        sha256: 'a'.repeat(64),
        size_bytes: 12345,
        sheets: [
          { sheet_name: '00_Decision', row_count: 1 }
        ],
        generated_at: '2026-06-09T12:00:00Z'
      },
      file_content_base64: Buffer.from('mock-excel-bytes').toString('base64')
    };

    vi.stubGlobal('fetch', vi.fn(async () => {
      return {
        ok: true,
        json: async () => mockWorkerRes
      };
    }));

    const res = await EXPORT_POST(
      new Request('http://test/api/audit/export', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id })
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_id).toBe(job.job_id);
    expect(body.manifest.sha256).toBe('a'.repeat(64));
    expect(body.file_content_base64).toBe(mockWorkerRes.file_content_base64);
  });
});
