import { describe, it, expect, vi } from 'vitest';
import { POST as APPROVE_POST } from '../src/app/api/audit/approve/route';
import { STORE } from '../src/lib/job-store';

describe('POST /api/audit/approve', () => {
  it('JOB_NOT_FOUND', async () => {
    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: 'job_nope', approval_scope: 'ZERO_APPROVED' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('INVALID_STATE if job status is not REVIEW_REQUIRED', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'CREATED' });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(409);
  });

  it('400 BAD_REQUEST if scope is AMBER_ACK but acknowledgement_reason is missing', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED' });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'AMBER_ACK' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('403 HUMAN_GATE_REQUIRED if ZERO trigger is active but role lacks authority', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });
    
    // Set up normalized invoice total >= 100k AED (triggers HGT_01)
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 150000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: {
          'x-user-role': 'COST_CONTROL_LEAD', // Needs FINANCE_APPROVER
          'x-user-id': 'u1'
        }
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('HUMAN_GATE_REQUIRED');
  });

  it('200 APPROVED if authorized user approves', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });

    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 150000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: {
          'x-user-role': 'FINANCE_APPROVER',
          'x-user-id': 'u1'
        }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('APPROVED');
    expect(body.prism_kernel_proof_ref).toBeDefined();

    const updatedJob = await STORE.getJob(job.job_id);
    expect(updatedJob?.status).toBe('APPROVED');
  });
});

// 2026-06-17 — approval-gated Vision OCR. enable_vision: true is the
// explicit reviewer opt-in. Default behaviour (omitted/false) is unchanged:
// no Vision state is written, the response carries no `vision` field.
describe('POST /api/audit/approve — enable_vision', () => {
  it('omits `vision` from the response when enable_vision is not set', async () => {
    const job = await STORE.createJob({ created_by: 'user_v0' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i0', invoice_header: { currency: 'AED', invoice_total: 100.0 },
      invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p0'
    });

    const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
      headers: { 'x-user-role': 'FINANCE_APPROVER', 'x-user-id': 'u0' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vision).toBeUndefined();
    expect(await STORE.getVisionStatus(job.job_id)).toBeUndefined();
  });

  it('enable_vision=true with no PDF source → vision_status=skipped, VISION_NO_PDF', async () => {
    const job = await STORE.createJob({ created_by: 'user_v1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i1', invoice_header: { currency: 'AED', invoice_total: 50.0 },
      invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p1'
    });

    const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
      method: 'POST',
      body: JSON.stringify({
        job_id: job.job_id, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'ok',
        enable_vision: true
      }),
      headers: { 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'u1' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vision.vision_status).toBe('skipped');
    expect(body.vision.vision_error_code).toBe('VISION_NO_PDF');

    const stored = await STORE.getVisionStatus(job.job_id);
    expect(stored?.vision_status).toBe('skipped');
  });

  it('enable_vision=true with non-gs:// PDF → vision_status=skipped, VISION_NON_GCS_SOURCE', async () => {
    const job = await STORE.createJob({ created_by: 'user_v2' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i2', invoice_header: { currency: 'AED', invoice_total: 50.0 },
      invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p2'
    });
    await STORE.addSourceFile(job.job_id, {
      file_id: 'pdf_nongs', job_id: job.job_id,
      original_filename: 'scanned.pdf', file_type: 'pdf', mime_type: 'application/pdf',
      size_bytes: 123, sha256: 'a'.repeat(64), blob_ref: 'vercel-blob://x',
      blob_url: null, parser_status: 'PARSED', uploaded_by: 'user_v2',
      uploaded_at: new Date().toISOString()
    });

    const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
      method: 'POST',
      body: JSON.stringify({
        job_id: job.job_id, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'ok',
        enable_vision: true
      }),
      headers: { 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'u2' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vision.vision_status).toBe('skipped');
    expect(body.vision.vision_error_code).toBe('VISION_NON_GCS_SOURCE');
  });

  it('enable_vision=true without worker env → vision_status=failed, WORKER_CONFIG_MISSING', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    delete process.env.PARSER_WORKER_URL;
    delete process.env.PARSER_WORKER_TOKEN;

    const job = await STORE.createJob({ created_by: 'user_v3' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i3', invoice_header: { currency: 'AED', invoice_total: 50.0 },
      invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p3'
    });
    await STORE.addSourceFile(job.job_id, {
      file_id: 'pdf_g', job_id: job.job_id,
      original_filename: 'scanned.pdf', file_type: 'pdf', mime_type: 'application/pdf',
      size_bytes: 123, sha256: 'b'.repeat(64),
      blob_ref: 'gs://dsv-invoice-source/source/j3/pdf_g/input.pdf',
      blob_url: null, parser_status: 'PARSED', uploaded_by: 'user_v3',
      uploaded_at: new Date().toISOString()
    });

    const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
      method: 'POST',
      body: JSON.stringify({
        job_id: job.job_id, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'ok',
        enable_vision: true
      }),
      headers: { 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'u3' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vision.vision_status).toBe('failed');
    expect(body.vision.vision_error_code).toBe('WORKER_CONFIG_MISSING');

    if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
    if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
  });

  it('enable_vision=true happy path → worker /v1/vision/start → vision_status=running', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    // Route-aware mock: only the worker call gets the STARTED response;
    // any other fetch (e.g. STORE setup traffic) gets a benign default.
    fetchMock.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s.includes('/v1/vision/start')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            job_id: 'j4', file_id: 'pdf_g',
            operation_name: 'operations/op_test_1',
            output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/j4/pdf_g/',
            status: 'STARTED'
          })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    try {
      const job = await STORE.createJob({ created_by: 'user_v4' });
      await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
      await STORE.setNormalizedInvoice(job.job_id, {
        invoice_id: 'i4', invoice_header: { currency: 'AED', invoice_total: 50.0 },
        invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p4'
      });
      await STORE.addSourceFile(job.job_id, {
        file_id: 'pdf_g', job_id: job.job_id,
        original_filename: 'scanned.pdf', file_type: 'pdf', mime_type: 'application/pdf',
        size_bytes: 123, sha256: 'c'.repeat(64),
        blob_ref: 'gs://dsv-invoice-source/source/j4/pdf_g/input.pdf',
        blob_url: null, parser_status: 'PARSED', uploaded_by: 'user_v4',
        uploaded_at: new Date().toISOString()
      });

      const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({
          job_id: job.job_id, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'ok',
          enable_vision: true
        }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'u4' }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision.vision_status).toBe('running');
      expect(body.vision.vision_operation_name).toBe('operations/op_test_1');

      // Find the worker call among any setup traffic
      const workerCall = fetchMock.mock.calls.find(
        ([u]) => String(u).includes('/v1/vision/start')
      );
      expect(workerCall).toBeDefined();
      const [calledUrl, calledOpts] = workerCall as [unknown, unknown];
      expect(String(calledUrl)).toBe('http://worker.test/v1/vision/start');
      expect((calledOpts as { headers: { authorization: string } }).headers.authorization).toBe('Bearer tok');
      const sentBody = JSON.parse((calledOpts as { body: string }).body);
      expect(sentBody).toEqual({
        job_id: job.job_id,
        file_id: 'pdf_g',
        source_gcs_uri: 'gs://dsv-invoice-source/source/j4/pdf_g/input.pdf',
        output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/' + job.job_id + '/pdf_g/'
      });

      // Approval record carries the opt-in
      const rec = await STORE.getApprovalRecord(job.job_id);
      expect(rec?.enable_vision).toBe(true);
      expect(rec?.vision_requested_by).toBe('u4');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });

  it('idempotent: re-approving with same PDF sha256 returns cached `done`', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'http://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok';

    const fetchMock = vi.fn();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    try {
      const job = await STORE.createJob({ created_by: 'user_v5' });
      await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
      await STORE.setNormalizedInvoice(job.job_id, {
        invoice_id: 'i5', invoice_header: { currency: 'AED', invoice_total: 50.0 },
        invoice_lines: [], evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p5'
      });
      await STORE.addSourceFile(job.job_id, {
        file_id: 'pdf_g', job_id: job.job_id,
        original_filename: 'scanned.pdf', file_type: 'pdf', mime_type: 'application/pdf',
        size_bytes: 123, sha256: 'd'.repeat(64),
        blob_ref: 'gs://dsv-invoice-source/source/j5/pdf_g/input.pdf',
        blob_url: null, parser_status: 'PARSED', uploaded_by: 'user_v5',
        uploaded_at: new Date().toISOString()
      });

      // Pre-seed a terminal `done` record for the same PDF
      const now = new Date().toISOString();
      await STORE.setVisionStatus(job.job_id, {
        vision_status: 'done',
        vision_operation_name: 'operations/op_old',
        vision_pdf_file_id: 'pdf_g',
        vision_pdf_sha256: 'd'.repeat(64),
        vision_source_gcs_uri: 'gs://dsv-invoice-source/source/j5/pdf_g/input.pdf',
        vision_output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/j5/pdf_g/',
        vision_started_at: now,
        vision_completed_at: now,
        vision_updated_at: now,
        vision_error_code: null,
        vision_error_message: null,
        vision_ocr_result: {
          page_count: 1, confidence: 0.91,
          ocr_json_gcs_uri: 'gs://dsv-invoice-ocr/j5/pdf_g/result.json',
          ocr_json_gcs_uris: [],
          invoice_lines: [], evidence_candidates: [], issues: []
        }
      });

      const res = await APPROVE_POST(new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({
          job_id: job.job_id, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'ok',
          enable_vision: true
        }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'u5' }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vision.vision_status).toBe('done');
      expect(body.vision.vision_operation_name).toBe('operations/op_old');

      // Worker /v1/vision/start should NOT be called for an already-done job
      // (other fetch calls from STORE setup traffic are unrelated)
      const workerCalls = fetchMock.mock.calls.filter(
        ([u]) => String(u).includes('/v1/vision/start')
      );
      expect(workerCalls).toHaveLength(0);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      if (prevUrl !== undefined) process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken !== undefined) process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });
});
