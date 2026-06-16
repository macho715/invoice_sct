import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetJob = vi.fn();
const mockGetResult = vi.fn();
const mockGetNormalizedInvoice = vi.fn();
const mockGetValidationResult = vi.fn();
const mockGetApprovalRecord = vi.fn();
const mockGetParseSourceData = vi.fn();
const mockListTrace = vi.fn();

vi.mock('../src/lib/job-store', () => ({
  STORE: {
    getJob: (...args: unknown[]) => mockGetJob(...args),
    getResult: (...args: unknown[]) => mockGetResult(...args),
    getNormalizedInvoice: (...args: unknown[]) => mockGetNormalizedInvoice(...args),
    getValidationResult: (...args: unknown[]) => mockGetValidationResult(...args),
    getApprovalRecord: (...args: unknown[]) => mockGetApprovalRecord(...args),
    getParseSourceData: (...args: unknown[]) => mockGetParseSourceData(...args),
    listTrace: (...args: unknown[]) => mockListTrace(...args),
  },
}));

import { buildExportRequest } from '../src/lib/workbook-builder';

const JOB_ID = 'job_test123';

function makeSampleJob(overrides = {}) {
  return {
    job_id: JOB_ID,
    status: 'COMPLETED' as const,
    verdict: 'AMBER' as const,
    created_by: 'u1',
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    rule_version: 'rule-0.1.0',
    parser_version: 'parser-0.1.0',
    ...overrides,
  };
}

function makeSampleResult(overrides = {}) {
  return {
    verdict: 'AMBER' as const,
    line_results: [
      { line_id: 'l1', verdict: 'PASS' as const, band: 'PASS' as const, delta_pct: null, reason_codes: ['OK'] },
      { line_id: 'l2', verdict: 'AMBER' as const, band: 'WARN' as const, delta_pct: 5.0, reason_codes: ['RATE_DELTA'] },
      { line_id: 'l3', verdict: 'ZERO' as const, band: 'HIGH' as const, delta_pct: 12.0, reason_codes: ['AMOUNT_MISMATCH'] },
      { line_id: 'l4', verdict: 'ZERO' as const, band: 'CRITICAL' as const, delta_pct: 20.0, reason_codes: ['EVIDENCE_MISSING'] },
      { line_id: 'l5', verdict: 'AMBER' as const, band: 'WARN' as const, delta_pct: 3.0, reason_codes: ['RATE_DELTA'] },
    ],
    action_items: [],
    ...overrides,
  };
}

function makeSampleLines() {
  return [
    { line_id: 'l1', shipment_ref: 'SHP-001', description: 'TRUCKING', amount: 1000, currency: 'AED' as const, rate: null, rate_basis: null, numeric_integrity_status: 'PASS' as const, numeric_delta: null, rate_source_candidate: 'CONTRACT' as const, for_charge_component: null, type_b: null, evidence_status: 'MATCHED' as const, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
    { line_id: 'l2', shipment_ref: 'SHP-002', description: 'SEA FREIGHT', amount: 5000, currency: 'USD' as const, rate: null, rate_basis: null, numeric_integrity_status: null, numeric_delta: null, rate_source_candidate: null, for_charge_component: null, type_b: null, evidence_status: null, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
    { line_id: 'l3', shipment_ref: 'SHP-002', description: 'HANDLING', amount: 2000, currency: 'USD' as const, rate: null, rate_basis: null, numeric_integrity_status: null, numeric_delta: null, rate_source_candidate: null, for_charge_component: null, type_b: null, evidence_status: null, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
    { line_id: 'l4', shipment_ref: 'SHP-001', description: 'CUSTOMS', amount: 3000, currency: 'AED' as const, rate: null, rate_basis: null, numeric_integrity_status: null, numeric_delta: null, rate_source_candidate: null, for_charge_component: null, type_b: null, evidence_status: null, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
    { line_id: 'l5', shipment_ref: null, description: 'DOC FEE', amount: 500, currency: 'AED' as const, rate: null, rate_basis: null, numeric_integrity_status: null, numeric_delta: null, rate_source_candidate: null, for_charge_component: null, type_b: null, evidence_status: null, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
  ];
}

function makeSampleCostguardResults() {
  return [
    { line_id: 'l1', band: 'PASS' as const, verdict: 'PASS', delta_pct: null, prism_kernel_proof_ref: null },
    { line_id: 'l2', band: 'WARN' as const, verdict: 'AMBER', delta_pct: 5.0, prism_kernel_proof_ref: 'proof_l2' },
    { line_id: 'l3', band: 'HIGH' as const, verdict: 'ZERO', delta_pct: 12.0, prism_kernel_proof_ref: 'proof_l3' },
    { line_id: 'l4', band: 'CRITICAL' as const, verdict: 'ZERO', delta_pct: 20.0, prism_kernel_proof_ref: null },
    { line_id: 'l5', band: 'WARN' as const, verdict: 'AMBER', delta_pct: 3.0, prism_kernel_proof_ref: null },
  ];
}

function setupFullMocks() {
  mockGetJob.mockResolvedValue(makeSampleJob());
  mockGetResult.mockResolvedValue(makeSampleResult());
  mockGetNormalizedInvoice.mockResolvedValue({
    invoice_id: 'inv_001',
    invoice_header: { invoice_no: 'INV-001', vendor: 'OFCO', issue_date: '2026-06-01', currency: 'AED' as const, invoice_total: 11500 },
    invoice_lines: makeSampleLines(),
    evidence_candidates: [],
    parser_confidence: 0.95,
    parser_version: 'parser-0.1.0',
  });
  mockGetValidationResult.mockResolvedValue({
    validation_id: 'val_001',
    job_id: JOB_ID,
    sct_trace_id: 'trace_001',
    cf_mcp_tool_calls: [{ tool: 'check_cost_guard', latency_ms: 120, status: 'OK' as const, request_ref: null, response_ref: null }],
    type_b_results: [],
    hs_uae_results: [],
    rate_checks: [],
    evidence_requirements: [],
    costguard_results: makeSampleCostguardResults(),
    doc_guardian_results: [],
    gate_results: [],
    confidence: 0.95,
    reason_codes: [],
    warnings: [],
  });
  mockGetApprovalRecord.mockResolvedValue(null);
  mockGetParseSourceData.mockResolvedValue([]);
  mockListTrace.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetParseSourceData.mockResolvedValue([]);
  mockListTrace.mockResolvedValue([]);
});

// ---------- T16 TEST 1 ----------
describe('buildExportRequest - error for unknown jobId', () => {
  it('throws when STORE.getJob returns undefined', async () => {
    mockGetJob.mockResolvedValue(undefined);

    await expect(buildExportRequest('job_nonexistent')).rejects.toThrow('Job not found');
  });

  it('throws when STORE.getResult returns undefined', async () => {
    mockGetJob.mockResolvedValue(makeSampleJob());
    mockGetResult.mockResolvedValue(undefined);

    await expect(buildExportRequest(JOB_ID)).rejects.toThrow('Result not ready');
  });
});

// ---------- T16 TEST 2 ----------
describe('buildExportRequest - correct structure', () => {
  it('returns decision_rows and line_view_rows keys', async () => {
    setupFullMocks();

    const result = await buildExportRequest(JOB_ID);

    expect(result).toHaveProperty('decision_rows');
    expect(result).toHaveProperty('line_view_rows');
    expect(result).toHaveProperty('final_recon_rows');
    expect(result).toHaveProperty('action_items_rows');
    expect(result.decision_rows).toHaveLength(1);
    expect(result.line_view_rows).toHaveLength(5);
    expect(result.decision_rows[0]).toMatchObject({
      job_id: JOB_ID,
      verdict: 'AMBER',
      watermark: 'SCT_AUDIT_DRAFT',
    });
  });

  it('includes PDF fixture source_data pdf_page and text_span_hash in 90_Source_Data rows', async () => {
    setupFullMocks();
    mockGetParseSourceData.mockResolvedValue([
      {
        file_id: 'file_pdf_fixture',
        source_ref: 'SHP-001',
        original_text: 'Fixture PDF text span for shipment SHP-001',
        normalized_value: 'SHP-001',
        confidence: 0.91,
        routing_pattern: 'PDF_TEXT_SPAN',
        pdf_page: 2,
        text_span_hash: 'span_hash_fixture_001',
        doc_type: 'WAYBILL',
        shipment_id: 'SHP-001',
        is_portal_fee: false,
      },
    ]);

    const result = await buildExportRequest(JOB_ID);

    expect(result.source_data_rows).toContainEqual(expect.objectContaining({
      file_id: 'file_pdf_fixture',
      pdf_page: 2,
      text_span_hash: 'span_hash_fixture_001',
      doc_type: 'WAYBILL',
      shipment_id: 'SHP-001',
      is_portal_fee: false,
    }));
  });
});

// ---------- T16 TEST 3 ----------
describe('buildExportRequest - final recon variance', () => {
  it('calculates variance correctly for grouped shipments', async () => {
    setupFullMocks();

    const result = await buildExportRequest(JOB_ID);

    expect(result.final_recon_rows).toHaveLength(3); // AED|SHP-001, USD|SHP-002, AED| (null shipment_ref)

    const aedShp001 = result.final_recon_rows.find(r => r.currency === 'AED' && r.shipment_ref === 'SHP-001');
    expect(aedShp001).toBeDefined();
    // line l1: 1000, delta_pct=null → diff=0, reviewed=1000
    // line l4: 3000, delta_pct=20 → diff=600, reviewed=2400
    // total: invoice=4000, reviewed=3400, variance=600, pct=15.0
    expect(aedShp001!.invoice_total).toBe(4000);
    expect(aedShp001!.reviewed_total).toBe(3400);
    expect(aedShp001!.variance).toBe(600);
    expect(aedShp001!.variance_pct).toBe(15.0);
    expect(aedShp001!.recon_status).toBe('MISMATCH');

    const usdShp002 = result.final_recon_rows.find(r => r.currency === 'USD' && r.shipment_ref === 'SHP-002');
    expect(usdShp002).toBeDefined();
    // line l2: 5000, delta_pct=5 → diff=250, reviewed=4750
    // line l3: 2000, delta_pct=12 → diff=240, reviewed=1760
    // total: invoice=7000, reviewed=6510, variance=490, pct=7.0
    expect(usdShp002!.invoice_total).toBe(7000);
    expect(usdShp002!.reviewed_total).toBe(6510);
    expect(usdShp002!.variance).toBe(490);
    expect(usdShp002!.variance_pct).toBeCloseTo(7.0, 4);
    expect(usdShp002!.recon_status).toBe('MISMATCH');

    const aedNull = result.final_recon_rows.find(r => r.currency === 'AED' && r.shipment_ref === null);
    expect(aedNull).toBeDefined();
    // line l5: 500, delta_pct=3 → diff=15, reviewed=485
    expect(aedNull!.invoice_total).toBe(500);
    expect(aedNull!.variance).toBe(15);
    expect(aedNull!.recon_status).toBe('MISMATCH');
  });

  it('sets final_recon_status to MATCHED when all groups match', async () => {
    mockGetJob.mockResolvedValue(makeSampleJob());
    mockGetResult.mockResolvedValue(makeSampleResult());
    mockGetNormalizedInvoice.mockResolvedValue({
      invoice_id: 'inv_002',
      invoice_header: { invoice_no: null, vendor: null, issue_date: null, currency: 'AED' as const, invoice_total: null },
      invoice_lines: [
        { line_id: 'l1', shipment_ref: 'SHP-001', description: 'TRUCKING', amount: 1000, currency: 'AED' as const, rate: null, rate_basis: null, numeric_integrity_status: null, numeric_delta: null, rate_source_candidate: null, for_charge_component: null, type_b: null, evidence_status: null, rate_status: null, validity_status: null, gate_status: null, band: null, delta_pct: null, normalized_description: null, qty: null, source_ref: null },
      ],
      evidence_candidates: [],
      parser_confidence: 1.0,
      parser_version: 'parser-0.1.0',
    });
    mockGetValidationResult.mockResolvedValue({
      validation_id: 'val_002',
      job_id: JOB_ID,
      sct_trace_id: 'trace_002',
      cf_mcp_tool_calls: [],
      type_b_results: [],
      hs_uae_results: [],
      rate_checks: [],
      evidence_requirements: [],
      costguard_results: [{ line_id: 'l1', band: 'PASS' as const, verdict: 'PASS', delta_pct: 0, prism_kernel_proof_ref: null }],
      doc_guardian_results: [],
      gate_results: [],
      confidence: 1.0,
      reason_codes: [],
      warnings: [],
    });
    mockGetApprovalRecord.mockResolvedValue(null);

    const result = await buildExportRequest(JOB_ID);

    expect(result.final_recon_rows).toHaveLength(1);
    expect(result.final_recon_rows[0].variance).toBe(0);
    expect(result.final_recon_rows[0].recon_status).toBe('MATCHED');
    expect(result.decision_rows[0].final_recon_status).toBe('MATCHED');
  });
});

// ---------- T16 TEST 4 ----------
describe('buildExportRequest - band counts', () => {
  it('counts PASS/WARN/HIGH/CRITICAL bands correctly', async () => {
    setupFullMocks();

    const result = await buildExportRequest(JOB_ID);

    expect(result.decision_rows[0].zero_count).toBe(2);  // l3, l4
    expect(result.decision_rows[0].amber_count).toBe(2); // l2, l5

    const summary = result.decision_rows[0].costguard_band_summary;
    expect(summary).toBe('PASS: 1, WARN: 2, HIGH: 1, CRITICAL: 1');
  });

  it('handles empty line_results gracefully', async () => {
    mockGetJob.mockResolvedValue(makeSampleJob());
    mockGetResult.mockResolvedValue({ verdict: 'PASS' as const, line_results: [], action_items: [] });
    mockGetNormalizedInvoice.mockResolvedValue({
      invoice_id: 'inv_003',
      invoice_header: { invoice_no: null, vendor: null, issue_date: null, currency: 'AED' as const, invoice_total: null },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 1.0,
      parser_version: 'parser-0.1.0',
    });
    mockGetValidationResult.mockResolvedValue(null);
    mockGetApprovalRecord.mockResolvedValue(null);

    const result = await buildExportRequest(JOB_ID);

    expect(result.decision_rows[0].zero_count).toBe(0);
    expect(result.decision_rows[0].amber_count).toBe(0);
    expect(result.decision_rows[0].costguard_band_summary).toBe('PASS: 0, WARN: 0, HIGH: 0, CRITICAL: 0');
  });
});


describe('buildExportRequest - duplicate checks', () => {
  it('populates duplicate_check_rows from duplicate validation results without raw vendor data', async () => {
    setupFullMocks();
    mockGetResult.mockResolvedValue(makeSampleResult({
      verdict: 'ZERO' as const,
      action_items: [{
        action_id: 'act_dup_001',
        severity: 'ZERO' as const,
        line_id: '',
        issue_type: 'DUPLICATE_INVOICE',
        required_action: 'Duplicate invoice detected — hold payment and Finance approval required'
      }]
    }));
    mockGetValidationResult.mockResolvedValue({
      validation_id: 'val_dup_001',
      job_id: JOB_ID,
      sct_trace_id: 'trace_dup_001',
      cf_mcp_tool_calls: [{ tool: 'check_duplicate_invoice', latency_ms: 42, status: 'OK' as const, request_ref: null, response_ref: null }],
      type_b_results: [],
      hs_uae_results: [],
      rate_checks: [],
      evidence_requirements: [],
      costguard_results: makeSampleCostguardResults(),
      doc_guardian_results: [],
      gate_results: [],
      confidence: 0.95,
      reason_codes: ['DUPLICATE_INVOICE'],
      warnings: [],
      duplicate_checks: [{
        vendor_hash: 'a'.repeat(64),
        invoice_no_hash: 'b'.repeat(64),
        verdict: 'ZERO',
        reason_code: 'DUPLICATE_INVOICE',
        duplicate_count: 1,
        amount_hash: 'amount_hash_11500',
        issue_date_hash: 'issue_date_hash_20260601',
        matched_job_id: 'job_prior'
      }]
    } as any);

    const result = await buildExportRequest(JOB_ID);

    expect(result.action_items_rows.some(a => a.issue_type === 'DUPLICATE_INVOICE' && a.severity === 'ZERO')).toBe(true);
    expect(result.duplicate_check_rows).toEqual([{
      vendor_hash: 'a'.repeat(64),
      invoice_no_hash: 'b'.repeat(64),
      amount_hash: 'amount_hash_11500',
      issue_date_hash: 'issue_date_hash_20260601',
      match_type: 'DUPLICATE_INVOICE',
      severity: 'ZERO',
      matched_job_id: 'job_prior'
    }]);
    expect(JSON.stringify(result.duplicate_check_rows)).not.toContain('OFCO');
  });
});
