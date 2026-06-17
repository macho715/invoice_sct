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

  // 2026-06-17: Blocking regression guard for the OCR-merge contract.
  //
  // /v1/vision/collect only returns counts (page_count, evidence_candidate_count)
  // and stores `ocr_json_gcs_uri(s)`, but the orchestrator must still surface the
  // OCR-augmented lines/evidence into the re-validation input AND the export
  // request body. Otherwise the workbook that ships after a re-run still
  // reflects the pre-OCR normalized invoice, breaking the "OCR → variance
  // re-compute" promise.
  //
  // RED today: runPipeline reads only STORE.getNormalizedInvoice().invoice_lines,
  // so the OCR-augmented lines never reach buildExportRequest or the worker.
  it('OCR-augmented invoice_lines/evidence_candidates from vision_ocr_result flow into the worker /v1/export body', async () => {
    const prevUrl = process.env.PARSER_WORKER_URL;
    const prevToken = process.env.PARSER_WORKER_TOKEN;
    process.env.PARSER_WORKER_URL = 'https://worker.test';
    process.env.PARSER_WORKER_TOKEN = 'tok_test';

    try {
      // 1) Job with a vision OCR record carrying OCR-augmented lines/evidence.
      //    Both pre-OCR and OCR-augmented lines satisfy LineViewRowSchema so
      //    buildExportRequest's Zod parse never throws before reaching /v1/export.
      const lineShape = {
        shipment_ref: 'SHP-001', description: 'd', for_charge_component: null,
        type_b: null, currency: 'AED', rate_source: null, rate_status: null,
        validity_status: null, evidence_status: null, gate_status: null,
        band: null, delta_pct: null, numeric_integrity_status: null,
        difference: null, risk: null, action: null, formula_text: null
      };
      const job = await makeJob({ withVision: true });
      const rec = (await STORE.getVisionStatus(job.job_id)) as VisionStatusRecord;
      const augmented: VisionStatusRecord = {
        ...rec,
        vision_ocr_result: {
          ...(rec.vision_ocr_result as Record<string, unknown>),
          invoice_lines: [
            { line_id: 'ocr_l1', ...lineShape, amount: 100 },
            { line_id: 'ocr_l2', ...lineShape, amount: 200 }
          ],
          evidence_candidates: [
            { source_file_id: 'pdf1', page: 1, snippet: 'OCR evidence' }
          ]
        } as VisionStatusRecord['vision_ocr_result']
      };
      await STORE.setVisionStatus(job.job_id, augmented);

      // 2) Seed a pre-OCR normalized invoice with DIFFERENT lines so the test
      //    can tell the two apart. Also seed a GateResult + validation +
      //    approval so buildExportRequest reaches the worker /v1/export call.
      await STORE.setNormalizedInvoice(job.job_id, {
        invoice_header: {
          invoice_no: 'INV-001', vendor: 'V', issue_date: '2026-06-17',
          currency: 'AED', invoice_total: 50, vat: 0
        },
        invoice_lines: [
          { line_id: 'pre_l1', ...lineShape, amount: 50 }
        ],
        evidence_candidates: []
      } as never);
      await STORE.setResult(job.job_id, {
        verdict: 'AMBER',
        line_results: [],
        action_items: []
      });
      await STORE.setValidationResult(job.job_id, {
        issues: [],
        summary: { total: 0, amber: 0, zero: 0, pass: 0 },
        rule_version: 'rule-0.1.0'
      } as never);
      await STORE.setApprovalRecord(job.job_id, {
        approved_by: 'u', approved_at: new Date().toISOString(), verdict: 'AMBER',
        enable_vision: false, review_notes: null
      } as never);

      // 3) Mock worker /v1/export.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job_id: job.job_id,
            kind: 'audit_workbook',
            manifest: { sha256: 'b'.repeat(64), size_bytes: 1234 },
            blob_url: 'https://blob.test/audit.xlsx'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

      // 4) Trigger.
      await triggerReRun({
        jobId: job.job_id,
        triggeredBy: 'test',
        trigger: 'vision_ocr_done',
        visionRecord: (await STORE.getVisionStatus(job.job_id)) as VisionStatusRecord
      });

      // 5) Poll until worker /v1/export is hit (runPipeline is fire-and-forget).
      const deadline = Date.now() + 2000;
      let exportCall: unknown[] | undefined;
      while (Date.now() < deadline) {
        exportCall = fetchMock.mock.calls.find(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('/v1/export')
        );
        if (exportCall) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      // 6) RED: today the export body carries pre-OCR lines, not ocr_l1/ocr_l2.
      expect(exportCall, 'worker /v1/export was not called within 2s').toBeDefined();
      const body = JSON.parse((exportCall![1] as RequestInit).body as string);
      // ExportRequest shape uses `line_view_rows` (one row per normalized
      // line) — the assertion below proves OCR-augmented lines make it in.
      const lineViewRows = ((body.line_view_rows ?? []) as Array<{ line_id?: string }>);
      const lineIds = lineViewRows.map((l) => l.line_id);
      expect(lineIds, 'OCR-augmented line_ids should flow into export body').toEqual(
        expect.arrayContaining(['ocr_l1', 'ocr_l2'])
      );
    } finally {
      if (prevUrl === undefined) delete process.env.PARSER_WORKER_URL;
      else process.env.PARSER_WORKER_URL = prevUrl;
      if (prevToken === undefined) delete process.env.PARSER_WORKER_TOKEN;
      else process.env.PARSER_WORKER_TOKEN = prevToken;
    }
  });
});
