import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as DOWNLOAD_GET } from '../src/app/api/export/download/route';
import { POST as EXPORT_POST } from '../src/app/api/audit/export/route';
import { STORE } from '../src/lib/job-store';

describe('GET /api/export/download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('JOB_NOT_FOUND', async () => {
    const res = await DOWNLOAD_GET(
      new Request('http://test/api/export/download?job_id=job_nonexistent')
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('APPROVAL_REQUIRED if job is not approved', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setResult(job.job_id, { verdict: 'AMBER', line_results: [], action_items: [] });

    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('APPROVAL_REQUIRED');
  });

  it('ZERO_BLOCKED if job verdict is ZERO', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'ZERO' });
    await STORE.setResult(job.job_id, { verdict: 'ZERO', line_results: [], action_items: [] });

    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ZERO_BLOCKED');
  });

  it('success download of excel bytes', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'PASS' });
    await STORE.setResult(job.job_id, { verdict: 'PASS', line_results: [], action_items: [] });

    // Populate fake cache first
    const mockWorkerRes = {
      job_id: job.job_id,
      manifest: {
        sha256: 'a'.repeat(64),
        size_bytes: 17,
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

    // Generate
    const exportRes = await EXPORT_POST(
      new Request('http://test/api/audit/export', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id })
      })
    );
    expect(exportRes.status).toBe(200);

    // Download
    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('mock-excel-bytes');
  });
});
