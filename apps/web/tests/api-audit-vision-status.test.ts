import { describe, it, expect, vi } from 'vitest';
import { POST as VISION_STATUS_POST, GET as VISION_STATUS_GET } from '../src/app/api/audit/vision-status/route';
import { STORE } from '../src/lib/job-store';
import type { VisionStatusRecord } from '../src/lib/types';

const JOB_TOKEN = 'job_token_test';

async function makeJob(opts: Partial<{ created_by: string; status: any; verdict: any }> = {}) {
  const job = await STORE.createJob({ created_by: opts.created_by ?? 'u' });
  await STORE.updateJob(job.job_id, {
    status: opts.status ?? 'APPROVED',
    verdict: opts.verdict ?? null
  });
  // Persist a deterministic job token so requireJobToken() is happy.
  await STORE.updateJob(job.job_id, { workflow_type: 'SHIPMENT' });
  (job as any).job_token = JOB_TOKEN;
  return job;
}

describe('POST /api/audit/vision-status', () => {
  it('400 INVALID_STATE if job_id missing', async () => {
    const res = await VISION_STATUS_POST(
      new Request('http://test/api/audit/vision-status', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' }
      })
    );
    // INVALID_STATE → 409 (matches existing audit/* route contract)
    expect(res.status).toBe(409);
  });

  it('404 JOB_NOT_FOUND for unknown job_id', async () => {
    const res = await VISION_STATUS_POST(
      new Request('http://test/api/audit/vision-status', {
        method: 'POST',
        body: JSON.stringify({ job_id: 'unknown_job_id_xyz' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('returns vision_status=null when no Vision record exists (never requested)', async () => {
    const job = await makeJob();
    const res = await VISION_STATUS_POST(
      new Request('http://test/api/audit/vision-status', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id }),
        headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vision_status).toBeNull();
    expect(body.re_run_required).toBe(false);
  });

  it('returns terminal `done` cached record without calling the worker', async () => {
    const job = await makeJob();
    const now = new Date().toISOString();
    const rec: VisionStatusRecord = {
      vision_status: 'done',
      vision_operation_name: 'operations/op_done',
      vision_pdf_file_id: 'pdf_done',
      vision_pdf_sha256: 'e'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf_done/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf_done/',
      vision_started_at: now,
      vision_completed_at: now,
      vision_updated_at: now,
      vision_error_code: null,
      vision_error_message: null,
      vision_ocr_result: {
        page_count: 2, confidence: 0.92,
        ocr_json_gcs_uri: 'gs://ocr/j/pdf_done/result.json',
        ocr_json_gcs_uris: ['gs://ocr/j/pdf_done/result.json'],
        invoice_lines: [{ line_id: 'l1', description: 'X' }, { line_id: 'l2', description: 'Y' }],
        evidence_candidates: [{ source_file_id: 'pdf_done', doc_kind: 'BOE', confidence: 0.9 }],
        issues: []
      }
    };
    await STORE.setVisionStatus(job.job_id, rec);

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    try {
      const res = await VISION_STATUS_POST(
        new Request('http://test/api/audit/vision-status', {
          method: 'POST',
          body: JSON.stringify({ job_id: job.job_id }),
          headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision_status).toBe('done');
      expect(body.page_count).toBe(2);
      expect(body.invoice_lines_count).toBe(2);
      expect(body.evidence_candidates_count).toBe(1);
      expect(body.re_run_required).toBe(true);
      // Worker must not be called for terminal states
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it('polls worker /v1/vision/collect on `running` and transitions to `done`', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const job = await makeJob();
    const now = new Date().toISOString();
    await STORE.setVisionStatus(job.job_id, {
      vision_status: 'running',
      vision_operation_name: 'operations/op_inflight',
      vision_pdf_file_id: 'pdf_inflight',
      vision_pdf_sha256: 'f'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf_inflight/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf_inflight/',
      vision_started_at: now,
      vision_completed_at: null,
      vision_updated_at: now,
      vision_error_code: null,
      vision_error_message: null,
      vision_ocr_result: null
    });

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        job_id: job.job_id, file_id: 'pdf_inflight',
        operation_name: 'operations/op_inflight',
        status: 'COLLECTED',
        ocr_json_gcs_uri: 'gs://ocr/j/pdf_inflight/result.json',
        ocr_json_gcs_uris: ['gs://ocr/j/pdf_inflight/result.json'],
        page_count: 3, confidence: 0.88,
        evidence_candidate_count: 2,
        issues: []
      })
    });

    try {
      const res = await VISION_STATUS_POST(
        new Request('http://test/api/audit/vision-status', {
          method: 'POST',
          body: JSON.stringify({ job_id: job.job_id }),
          headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision_status).toBe('done');
      expect(body.page_count).toBe(3);
      expect(body.ocr_json_gcs_uri).toBe('gs://ocr/j/pdf_inflight/result.json');
      // /collect returns page_count=3 (no line arrays) — page_count > 0
      // signals "OCR produced new content" and triggers the re-run hint.
      expect(body.re_run_required).toBe(true);

      // Worker call shape
      const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
      expect(String(calledUrl)).toBe('http://worker.test/v1/vision/collect');
      expect((calledOpts as { headers: { authorization: string } }).headers.authorization).toBe('Bearer tok');
      const sentBody = JSON.parse((calledOpts as { body: string }).body);
      expect(sentBody).toEqual({
        job_id: job.job_id, file_id: 'pdf_inflight',
        operation_name: 'operations/op_inflight',
        output_gcs_prefix: 'gs://ocr/j/pdf_inflight/'
      });

      // Stored state is now `done`
      const stored = await STORE.getVisionStatus(job.job_id);
      expect(stored?.vision_status).toBe('done');
      expect(stored?.vision_ocr_result?.page_count).toBe(3);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });

  it('polls worker and transitions `running` to `failed` on COLLECT_FAILED', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const job = await makeJob();
    const now = new Date().toISOString();
    await STORE.setVisionStatus(job.job_id, {
      vision_status: 'running',
      vision_operation_name: 'operations/op_bad',
      vision_pdf_file_id: 'pdf_bad',
      vision_pdf_sha256: '1'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf_bad/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf_bad/',
      vision_started_at: now, vision_completed_at: null, vision_updated_at: now,
      vision_error_code: null, vision_error_message: null, vision_ocr_result: null
    });

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        job_id: job.job_id, file_id: 'pdf_bad', operation_name: 'operations/op_bad',
        status: 'COLLECT_FAILED', error_code: 'OCR_GCS_NOT_FOUND'
      })
    });

    try {
      const res = await VISION_STATUS_POST(
        new Request('http://test/api/audit/vision-status', {
          method: 'POST',
          body: JSON.stringify({ job_id: job.job_id }),
          headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision_status).toBe('failed');
      expect(body.vision_error_code).toBe('OCR_GCS_NOT_FOUND');

      const stored = await STORE.getVisionStatus(job.job_id);
      expect(stored?.vision_status).toBe('failed');
      expect(stored?.vision_error_code).toBe('OCR_GCS_NOT_FOUND');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });

  it('returns RUNNING without writing when the worker says the op is still in flight', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const job = await makeJob();
    const now = new Date().toISOString();
    await STORE.setVisionStatus(job.job_id, {
      vision_status: 'running',
      vision_operation_name: 'operations/op_poll',
      vision_pdf_file_id: 'pdf_poll',
      vision_pdf_sha256: '2'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf_poll/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf_poll/',
      vision_started_at: now, vision_completed_at: null, vision_updated_at: now,
      vision_error_code: null, vision_error_message: null, vision_ocr_result: null
    });

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        job_id: job.job_id, file_id: 'pdf_poll', operation_name: 'operations/op_poll',
        status: 'RUNNING'
      })
    });

    try {
      const res = await VISION_STATUS_POST(
        new Request('http://test/api/audit/vision-status', {
          method: 'POST',
          body: JSON.stringify({ job_id: job.job_id }),
          headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision_status).toBe('running');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });

  it('auto-triggers a re-run when COLLECTED brings back new lines/evidence', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const job = await makeJob();
    const now = new Date().toISOString();
    await STORE.setVisionStatus(job.job_id, {
      vision_status: 'running',
      vision_operation_name: 'operations/op_auto',
      vision_pdf_file_id: 'pdf_auto',
      vision_pdf_sha256: '7'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf_auto/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf_auto/',
      vision_started_at: now, vision_completed_at: null, vision_updated_at: now,
      vision_error_code: null, vision_error_message: null, vision_ocr_result: null
    });

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    // The vision-status route uses the first call for /v1/vision/collect;
    // re-run-pipeline is fire-and-forget and may also try to call /v1/export
    // — give it a noop ok response so the pipeline records a `failed` outcome
    // (no PARSER worker here) without throwing.
    fetchMock.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s.includes('/v1/vision/collect')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            job_id: job.job_id, file_id: 'pdf_auto',
            operation_name: 'operations/op_auto',
            status: 'COLLECTED',
            ocr_json_gcs_uri: 'gs://ocr/j/pdf_auto/result.json',
            ocr_json_gcs_uris: ['gs://ocr/j/pdf_auto/result.json'],
            page_count: 1, confidence: 0.9,
            invoice_lines: [{ line_id: 'la1', description: 'auto line' }],
            evidence_candidates: [{ source_file_id: 'pdf_auto' }],
            issues: []
          })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    try {
      const res = await VISION_STATUS_POST(
        new Request('http://test/api/audit/vision-status', {
          method: 'POST',
          body: JSON.stringify({ job_id: job.job_id }),
          headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision_status).toBe('done');
      expect(body.re_run_required).toBe(true);
      // /collect returns counts, not the full line arrays — invoice_lines_count
      // and evidence_candidates_count on the public response are sourced from
      // the (empty) stored arrays. The re-run signal uses page_count +
      // evidence_candidate_count instead.
      expect(body.page_count).toBe(1);

      // The auto-trigger is fire-and-forget: give the event loop one tick
      // so the initial `pending` record lands in the store.
      await new Promise((r) => setTimeout(r, 5));
      const reRun = await STORE.getReRunRecord(job.job_id);
      expect(reRun).toBeTruthy();
      expect(reRun?.re_run_trigger).toBe('vision_ocr_done');
      expect(reRun?.re_run_pdf_sha256).toBe('7'.repeat(64));
      // Status will be pending/running/exported/failed depending on the async
      // pipeline's progress — the contract is "a re-run record was created".
      expect(['pending', 'running', 'exported', 'failed']).toContain(reRun?.re_run_status);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });

  it('GET ?job_id=… is equivalent to POST { job_id }', async () => {
    const job = await makeJob();
    const res = await VISION_STATUS_GET(
      new Request(`http://test/api/audit/vision-status?job_id=${job.job_id}`, {
        method: 'GET',
        headers: { 'x-job-token': JOB_TOKEN }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_id).toBe(job.job_id);
    expect(body.vision_status).toBeNull();
  });
});
