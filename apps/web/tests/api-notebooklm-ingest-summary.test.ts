import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { POST } from '../src/app/api/notebooklm/ingest-summary/route';
import { STORE } from '../src/lib/job-store';
import type { NormalizedInvoice } from '../src/lib/types';

const HASH_A = 'a'.repeat(64);

async function makeJob() {
  const job = await STORE.createJob({ created_by: 'tester' });
  await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
  return job.job_id;
}

function validSummary(overrides: Record<string, unknown> = {}) {
  return {
    doc_kind: 'DSV_WAYBILL',
    fields: {
      invoice_no: 'INV-001',
      waybill_no: '0126-04466AUH',
      order_no: '10-ADOPT',
      job_no: 'JOB-001',
      po_no: 'PO-001',
      do_no: 'DO-001',
      bol_no: 'BOL-001',
      trip_no: 'TRIP-001',
      vendor: 'DSV',
      issue_date: '2026-06-14',
      currency: 'AED',
      amount: 1250
    },
    consignment_table: { order_no: '10-ADOPT' },
    lane: {
      origin_raw: 'MOSB Yard',
      destination_raw: 'Mirfa Site',
      origin_norm: 'MOSB_YARD',
      destination_norm: 'MIRFA_SITE',
      extraction_method: 'notebooklm'
    },
    timeline: {},
    shipment_ids: ['HVDC-ADOPT-001'],
    document_numbers: ['0126-04466AUH'],
    dates: ['2026-06-14'],
    amounts: ['1250'],
    confidence: 0.91,
    flags: [],
    ...overrides
  };
}

function parserResult(overrides: Partial<NormalizedInvoice> = {}): NormalizedInvoice {
  return {
    invoice_id: 'INV-001',
    invoice_header: {
      invoice_no: 'INV-001',
      vendor: 'DSV',
      issue_date: '2026-06-14',
      currency: 'AED',
      invoice_total: 1250
    },
    invoice_lines: [{
      line_id: 'l1',
      shipment_ref: '0126-04466AUH',
      job_number: 'JOB-001',
      description: 'Transport',
      normalized_description: null,
      qty: null,
      rate: null,
      rate_basis: null,
      currency: 'AED',
      amount: 1250,
      numeric_integrity_status: null,
      numeric_delta: null,
      rate_source_candidate: 'UNKNOWN',
      for_charge_component: null,
      type_b: null,
      source_ref: {}
    }],
    evidence_candidates: [],
    parser_confidence: 0.9,
    parser_version: 'parser-0.1.0',
    ...overrides
  };
}

async function postPayload(jobId: string, summary = validSummary(), extra: Record<string, unknown> = {}) {
  return POST(new Request('http://test/api/notebooklm/ingest-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      notebooklm_source_id: 'nlm_src_1',
      markdown_sha256: HASH_A,
      summary,
      ...extra
    })
  }));
}

describe('POST /api/notebooklm/ingest-summary', () => {
  it('accepts valid NotebookLM summary JSON and adapts it to parser-compatible shape', async () => {
    const jobId = await makeJob();
    await STORE.setNormalizedInvoice(jobId, parserResult());

    const res = await postPayload(jobId);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('SUMMARY_INGESTED');
    expect(body.parser_compatible.fields.waybill_no).toBe('0126-04466AUH');
    expect(body.parser_compatible.normalized.invoice_header.invoice_total).toBe(1250);
  });

  it('rejects missing job_id', async () => {
    const res = await POST(new Request('http://test/api/notebooklm/ingest-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notebooklm_source_id: 'nlm_src_1', summary: validSummary() })
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BAD_REQUEST');
  });

  it('rejects schema-invalid summaries', async () => {
    const jobId = await makeJob();
    const res = await postPayload(jobId, validSummary({ confidence: 1.2 }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BAD_REQUEST');
  });

  it('detects high-impact mismatches and marks the job for review', async () => {
    const jobId = await makeJob();
    await STORE.setNormalizedInvoice(jobId, parserResult());

    const res = await postPayload(jobId, validSummary({
      fields: { ...validSummary().fields, amount: 1300 }
    }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('NEEDS_REVIEW');
    expect(body.dual_extraction_mismatches.map((m: { field: string }) => m.field)).toContain('amount');
    const job = await STORE.getJob(jobId);
    expect(job?.status).toBe('REVIEW_REQUIRED');
    expect(job?.verdict).toBe('AMBER');
  });

  it('does not block an existing parser audit when NotebookLM callback fails', async () => {
    const jobId = await makeJob();
    await STORE.setNormalizedInvoice(jobId, parserResult());
    await STORE.updateJob(jobId, { status: 'VALIDATING', verdict: null });

    const res = await postPayload(jobId, validSummary({ confidence: -0.1 }));
    expect(res.status).toBe(400);
    const job = await STORE.getJob(jobId);
    expect(job?.status).toBe('VALIDATING');
    expect(job?.verdict).toBeNull();
  });

  it('marks parser-missing NotebookLM success as AMBER manual review', async () => {
    const jobId = await makeJob();

    const res = await postPayload(jobId);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('REVIEW_REQUIRED');
    expect(body.verdict).toBe('AMBER');
    const stored = await STORE.getNormalizedInvoice(jobId);
    expect(stored?.parser_version).toBe('notebooklm-first-pass-0.1.0');
  });

  it('stores audit trace hashes/status only, not raw markdown body', async () => {
    const jobId = await makeJob();
    await STORE.setNormalizedInvoice(jobId, parserResult());

    await postPayload(jobId, validSummary(), { markdown_body: 'RAW MARKDOWN BODY SHOULD NOT BE STORED' });
    const trace = await STORE.listTrace(jobId);
    const notebookTrace = trace.find(t => t.step === 'NOTEBOOKLM');
    expect(notebookTrace?.input_ref).toBe(HASH_A);
    expect(notebookTrace?.calculation_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(notebookTrace)).not.toContain('RAW MARKDOWN BODY SHOULD NOT BE STORED');
    expect(notebookTrace?.notebooklm_source_id).toBe('nlm_src_1');
    expect(notebookTrace?.notebooklm_confidence).toBe(0.91);
  });
});
