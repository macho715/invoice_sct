import { describe, it, expect } from 'vitest';
import { POST as RE_RUN_STATUS_POST, GET as RE_RUN_STATUS_GET } from '../src/app/api/audit/re-run-status/route';
import { STORE } from '../src/lib/job-store';
import { triggerReRun } from '../src/lib/re-run-pipeline';
import type { ReRunRecord, VisionStatusRecord } from '../src/lib/types';

const JOB_TOKEN = 'job_token_test';

async function makeJob() {
  const job = await STORE.createJob({ created_by: 'u' });
  await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'AMBER' });
  await STORE.updateJob(job.job_id, { workflow_type: 'SHIPMENT' });
  (job as any).job_token = JOB_TOKEN;

  const now = new Date().toISOString();
  const rec: VisionStatusRecord = {
    vision_status: 'done',
    vision_operation_name: 'operations/op_status',
    vision_pdf_file_id: 'pdf_s',
    vision_pdf_sha256: 'c'.repeat(64),
    vision_source_gcs_uri: 'gs://src/j/pdf_s/in.pdf',
    vision_output_gcs_prefix: 'gs://ocr/j/pdf_s/',
    vision_started_at: now,
    vision_completed_at: now,
    vision_updated_at: now,
    vision_error_code: null,
    vision_error_message: null,
    vision_ocr_result: {
      page_count: 1, confidence: 0.91,
      ocr_json_gcs_uri: 'gs://ocr/j/pdf_s/result.json',
      ocr_json_gcs_uris: [],
      invoice_lines: [{ line_id: 'ls1' }],
      evidence_candidates: [],
      issues: []
    }
  };
  await STORE.setVisionStatus(job.job_id, rec);
  return job;
}

describe('POST /api/audit/re-run-status', () => {
  it('returns null fields when no re-run record exists', async () => {
    const job = await makeJob();
    const res = await RE_RUN_STATUS_POST(new Request('http://test/api/audit/re-run-status', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_id).toBe(job.job_id);
    expect(body.re_run_status).toBeNull();
    expect(body.ready_to_download).toBe(false);
  });

  it('409 INVALID_STATE if job_id missing', async () => {
    const res = await RE_RUN_STATUS_POST(new Request('http://test/api/audit/re-run-status', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' }
    }));
    expect(res.status).toBe(409);
  });

  it('404 JOB_NOT_FOUND for unknown job_id', async () => {
    const res = await RE_RUN_STATUS_POST(new Request('http://test/api/audit/re-run-status', {
      method: 'POST',
      body: JSON.stringify({ job_id: 'unknown_xyz' }),
      headers: { 'content-type': 'application/json' }
    }));
    expect(res.status).toBe(404);
  });

  it('reflects an in-flight re-run after triggerReRun', async () => {
    const job = await makeJob();
    await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'test',
      trigger: 'vision_ocr_done',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });

    const res = await RE_RUN_STATUS_POST(new Request('http://test/api/audit/re-run-status', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Either 'pending' (initial state) or 'running' (after the async pipeline
    // marks it) — both indicate an in-flight re-run.
    expect(['pending', 'running']).toContain(body.re_run_status);
    expect(body.re_run_id).toBeTruthy();
    expect(body.ready_to_download).toBe(false);
  });

  it('surfaces an exported re-run with ready_to_download=true', async () => {
    const job = await makeJob();
    const now = new Date().toISOString();
    const exportedRec: ReRunRecord = {
      re_run_id: 'rerun_exported',
      re_run_status: 'exported',
      re_run_triggered_by: 'test',
      re_run_trigger: 'vision_ocr_done',
      re_run_pdf_sha256: 'c'.repeat(64),
      re_run_vision_operation_name: 'operations/op_status',
      re_run_started_at: now,
      re_run_completed_at: now,
      re_run_error_code: null,
      re_run_error_message: null,
      re_run_workbook_sha256: 'd'.repeat(64),
      re_run_workbook_size_bytes: 12345,
      re_run_workbook_blob_url: 'https://blob.example/wb.xlsx',
      re_run_prior_variance_aed: 100.0,
      re_run_new_variance_aed: 25.0,
      re_run_prior_verdict: 'AMBER',
      re_run_new_verdict: 'PASS'
    };
    await STORE.setReRunRecord(job.job_id, exportedRec);

    const res = await RE_RUN_STATUS_POST(new Request('http://test/api/audit/re-run-status', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id }),
      headers: { 'content-type': 'application/json', 'x-job-token': JOB_TOKEN }
    }));
    const body = await res.json();
    expect(body.re_run_status).toBe('exported');
    expect(body.re_run_workbook_blob_url).toBe('https://blob.example/wb.xlsx');
    expect(body.re_run_workbook_sha256).toBe('d'.repeat(64));
    expect(body.re_run_new_variance_aed).toBe(25.0);
    expect(body.re_run_prior_verdict).toBe('AMBER');
    expect(body.re_run_new_verdict).toBe('PASS');
    expect(body.ready_to_download).toBe(true);
  });

  it('GET ?job_id=… is equivalent to POST { job_id }', async () => {
    const job = await makeJob();
    const res = await RE_RUN_STATUS_GET(new Request(`http://test/api/audit/re-run-status?job_id=${job.job_id}`, {
      method: 'GET',
      headers: { 'x-job-token': JOB_TOKEN }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job_id).toBe(job.job_id);
    expect(body.re_run_status).toBeNull();
  });
});
