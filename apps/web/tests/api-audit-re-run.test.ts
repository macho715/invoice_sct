import { describe, it, expect, vi } from 'vitest';
import { POST as RE_RUN_POST } from '../src/app/api/audit/re-run/route';
import { STORE } from '../src/lib/job-store';
import type { VisionStatusRecord } from '../src/lib/types';

const JOB_TOKEN = 'job_token_test';

async function makeJob(opts: { visionStatus?: VisionStatusRecord['vision_status'] } = {}) {
  const job = await STORE.createJob({ created_by: 'u' });
  await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'AMBER' });
  await STORE.updateJob(job.job_id, { workflow_type: 'SHIPMENT' });
  (job as any).job_token = JOB_TOKEN;

  const now = new Date().toISOString();
  const rec: VisionStatusRecord = {
    vision_status: opts.visionStatus ?? 'done',
    vision_operation_name: 'operations/op_rerun',
    vision_pdf_file_id: 'pdf_r',
    vision_pdf_sha256: 'b'.repeat(64),
    vision_source_gcs_uri: 'gs://src/j/pdf_r/in.pdf',
    vision_output_gcs_prefix: 'gs://ocr/j/pdf_r/',
    vision_started_at: now,
    vision_completed_at: now,
    vision_updated_at: now,
    vision_error_code: null,
    vision_error_message: null,
    vision_ocr_result: {
      page_count: 1, confidence: 0.85,
      ocr_json_gcs_uri: 'gs://ocr/j/pdf_r/result.json',
      ocr_json_gcs_uris: [],
      invoice_lines: [{ line_id: 'lr1' }],
      evidence_candidates: [],
      issues: []
    }
  };
  await STORE.setVisionStatus(job.job_id, rec);
  return job;
}

describe('POST /api/audit/re-run', () => {
  it('400 INVALID_STATE if job_id missing', async () => {
    const res = await RE_RUN_POST(new Request('http://test/api/audit/re-run', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' }
    }));
    // INVALID_STATE → 409
    expect(res.status).toBe(409);
  });

  it('404 JOB_NOT_FOUND for unknown job_id', async () => {
    const res = await RE_RUN_POST(new Request('http://test/api/audit/re-run', {
      method: 'POST',
      body: JSON.stringify({ job_id: 'unknown' }),
      headers: { 'content-type': 'application/json' }
    }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('409 INVALID_STATE if vision record missing', async () => {
    const job = await STORE.createJob({ created_by: 'u' });
    await STORE.updateJob(job.job_id, { status: 'APPROVED' });
    (job as any).job_token = JOB_TOKEN;
    const res = await RE_RUN_POST(new Request('http://test/api/audit/re-run', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(409);
  });

  it('409 INVALID_STATE if vision_status is not done', async () => {
    const job = await makeJob({ visionStatus: 'running' });
    const res = await RE_RUN_POST(new Request('http://test/api/audit/re-run', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(409);
  });

  it('200 OK with re_run record on happy path', async () => {
    const job = await makeJob();
    const res = await RE_RUN_POST(new Request('http://test/api/audit/re-run', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id, triggered_by: 'tester' }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
    expect(body.re_run.re_run_trigger).toBe('manual');
    expect(body.re_run.re_run_triggered_by).toBe('tester');
    expect(body.re_run.re_run_pdf_sha256).toBe('b'.repeat(64));
  });
});
