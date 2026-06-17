import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { STORE } from '../src/lib/job-store';
import { triggerReRun } from '../src/lib/re-run-pipeline';
import type { VisionStatusRecord } from '../src/lib/types';

const JOB_TOKEN = 'job_token_test';

async function makeJob(opts: { withVision?: boolean; visionStatus?: VisionStatusRecord['vision_status'] } = {}) {
  const job = await STORE.createJob({ created_by: 'u' });
  await STORE.updateJob(job.job_id, { status: 'APPROVED', verdict: 'AMBER' });
  (job as any).job_token = JOB_TOKEN;

  if (opts.withVision) {
    const now = new Date().toISOString();
    const rec: VisionStatusRecord = {
      vision_status: opts.visionStatus ?? 'done',
      vision_operation_name: 'operations/op_test',
      vision_pdf_file_id: 'pdf1',
      vision_pdf_sha256: 'a'.repeat(64),
      vision_source_gcs_uri: 'gs://src/j/pdf1/in.pdf',
      vision_output_gcs_prefix: 'gs://ocr/j/pdf1/',
      vision_started_at: now,
      vision_completed_at: now,
      vision_updated_at: now,
      vision_error_code: null,
      vision_error_message: null,
      vision_ocr_result: {
        page_count: 2, confidence: 0.9,
        ocr_json_gcs_uri: 'gs://ocr/j/pdf1/result.json',
        ocr_json_gcs_uris: ['gs://ocr/j/pdf1/result.json'],
        invoice_lines: [{ line_id: 'l1' }, { line_id: 'l2' }],
        evidence_candidates: [{ source_file_id: 'pdf1' }],
        issues: []
      }
    };
    await STORE.setVisionStatus(job.job_id, rec);
  }
  return job;
}

describe('re-run-pipeline.triggerReRun', () => {
  beforeEach(() => fetchMock.mockReset());

  it('writes a `pending` record and returns it on first trigger', async () => {
    const job = await makeJob({ withVision: true });
    const result = await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'test',
      trigger: 'vision_ocr_done',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });
    expect(result.triggered).toBe(true);
    expect(result.reRun.re_run_status).toBe('pending');
    expect(result.reRun.re_run_trigger).toBe('vision_ocr_done');
    expect(result.reRun.re_run_pdf_sha256).toBe('a'.repeat(64));
  });

  it('idempotent: second call for same (trigger, pdf_sha256) returns cached and triggered=false', async () => {
    const job = await makeJob({ withVision: true });
    const first = await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'test',
      trigger: 'vision_ocr_done',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });
    const second = await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'test',
      trigger: 'vision_ocr_done',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });
    expect(second.triggered).toBe(false);
    expect(second.reRun.re_run_id).toBe(first.reRun.re_run_id);
  });

  it('different trigger for same job re-fires (manual vs vision_ocr_done)', async () => {
    const job = await makeJob({ withVision: true });
    const auto = await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'auto:vision-status',
      trigger: 'vision_ocr_done',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });
    const manual = await triggerReRun({
      jobId: job.job_id,
      triggeredBy: 'manual:user',
      trigger: 'manual',
      visionRecord: await STORE.getVisionStatus(job.job_id) as VisionStatusRecord
    });
    expect(auto.triggered).toBe(true);
    expect(manual.triggered).toBe(true);
    expect(manual.reRun.re_run_id).not.toBe(auto.reRun.re_run_id);
    expect(manual.reRun.re_run_trigger).toBe('manual');
  });
});
