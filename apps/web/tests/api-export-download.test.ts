import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as DOWNLOAD_GET } from '../src/app/api/export/download/route';
import { POST as EXPORT_POST } from '../src/app/api/audit/export/route';
import { POST as RUN_POST } from '../src/app/api/invoice-audit/run/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';
import { STORE } from '../src/lib/job-store';

describe('GET /api/export/download', () => {
  afterEach(() => {
    delete process.env.PARSER_WORKER_URL;
    delete process.env.WORKER_URL;
    delete process.env.PARSER_WORKER_TOKEN;
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

  function stubWorker(jobId: string) {
    const mockWorkerRes = {
      job_id: jobId,
      manifest: {
        sha256: 'b'.repeat(64),
        size_bytes: 16,
        sheets: [{ sheet_name: '00_Decision', row_count: 1 }],
        generated_at: '2026-06-09T12:00:00Z'
      },
      file_content_base64: Buffer.from('mock-excel-bytes').toString('base64')
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => mockWorkerRes })));
  }

  it('AMBER (not approved) still delivers the final Excel (Rule #1)', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setResult(job.job_id, { verdict: 'AMBER', line_results: [], action_items: [] });
    stubWorker(job.job_id);

    const exportRes = await EXPORT_POST(
      new Request('http://test/api/audit/export', { method: 'POST', body: JSON.stringify({ job_id: job.job_id }) })
    );
    expect(exportRes.status).toBe(200);

    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('ZERO still delivers the final Excel with verdict stamped (Rule #1)', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'ZERO' });
    await STORE.setResult(job.job_id, { verdict: 'ZERO', line_results: [], action_items: [] });
    stubWorker(job.job_id);

    const exportRes = await EXPORT_POST(
      new Request('http://test/api/audit/export', { method: 'POST', body: JSON.stringify({ job_id: job.job_id }) })
    );
    expect(exportRes.status).toBe(200);

    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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

  it('job page download flow serves workbook only after export creation populated the cache', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'PASS' });
    await STORE.setResult(job.job_id, { verdict: 'PASS', line_results: [], action_items: [] });

    const beforeExport = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(beforeExport.status).toBe(409);
    expect((await beforeExport.json()).message).toBe('Job has not been exported yet');

    stubWorker(job.job_id);
    const exportRes = await EXPORT_POST(
      new Request('http://test/api/audit/export', { method: 'POST', body: JSON.stringify({ job_id: job.job_id }) })
    );
    expect(exportRes.status).toBe(200);

    const res = await DOWNLOAD_GET(
      new Request(`http://test/api/export/download?job_id=${job.job_id}`)
    );
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))).toBe('mock-excel-bytes');
  });


  it.each([
    ['PDF_ENCRYPTED', 'PDF_ENCRYPTED: encrypted PDFs require manual review'],
    ['PDF_TOO_LARGE', 'PDF_TOO_LARGE: PDF exceeds parser page limit']
  ])('PDF-only %s parser failure is stored as AMBER and can export/download a review pack', async (expectedIssue, parserError) => {
    const fd = new FormData();
    fd.set('file', new File([`%PDF-1.4 ${expectedIssue} fixture`], `${expectedIssue}.pdf`, { type: 'application/pdf' }));
    const ingest = await INGEST_POST(new Request('http://test/api/files/ingest', {
      method: 'POST',
      body: fd,
      headers: { 'x-user-id': 'u1' }
    }));
    const uploaded = await ingest.json();

    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';
    const mockWorkerRes = {
      job_id: uploaded.job_id,
      manifest: {
        sha256: 'c'.repeat(64),
        size_bytes: 16,
        sheets: [{ sheet_name: '00_Decision', row_count: 1 }],
        generated_at: '2026-06-15T12:00:00Z'
      },
      file_content_base64: Buffer.from('mock-review-pack').toString('base64')
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/v1/parse')) {
        return { ok: false, status: 422, text: async () => parserError };
      }
      if (u.includes('/v1/export')) {
        return { ok: true, json: async () => mockWorkerRes };
      }
      return { ok: true, json: async () => ({}) };
    }));

    const run = await RUN_POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: uploaded.job_id }),
      headers: { 'content-type': 'application/json' }
    }));
    expect(run.status).toBe(202);
    await expect(run.json()).resolves.toMatchObject({
      status: 'REVIEW_REQUIRED',
      verdict: 'AMBER',
      action_items: [expect.objectContaining({ issue_type: expectedIssue })]
    });
    await expect(STORE.getJob(uploaded.job_id)).resolves.toMatchObject({ status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await expect(STORE.getNormalizedInvoice(uploaded.job_id)).resolves.toMatchObject({
      invoice_header: { currency: 'AED' },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0
    });
    await expect(STORE.getResult(uploaded.job_id)).resolves.toMatchObject({
      verdict: 'AMBER',
      action_items: [expect.objectContaining({ issue_type: expectedIssue })]
    });
    const traces = await STORE.listTrace(uploaded.job_id);
    expect(traces.map((t) => t.step)).toEqual(expect.arrayContaining(['PARSE', 'DECISION']));

    const exportRes = await EXPORT_POST(new Request('http://test/api/audit/export', {
      method: 'POST',
      body: JSON.stringify({ job_id: uploaded.job_id, kind: 'REVIEW_PACK' })
    }));
    expect(exportRes.status).toBe(200);

    const download = await DOWNLOAD_GET(new Request(`http://test/api/export/download?job_id=${uploaded.job_id}`));
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(new TextDecoder().decode(new Uint8Array(await download.arrayBuffer()))).toBe('mock-review-pack');
  });


});
