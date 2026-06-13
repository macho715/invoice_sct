import { describe, it, expect } from 'vitest';
import { evaluateHumanGateTriggers } from '../src/lib/human-gate';
import type { Job } from '../src/lib/job-store';
import type { NormalizedInvoice, SctValidationResult } from '../src/lib/types';

describe('human-gate evaluator', () => {
  const dummyJob: Job = {
    job_id: 'j1',
    status: 'REVIEW_REQUIRED',
    verdict: null,
    created_by: 'u1',
    created_at: '',
    updated_at: '',
    rule_version: 'r1',
    parser_version: 'p1'
  };

  it('evaluates High-Value Invoice trigger (HGT_01)', () => {
    const ni1: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 150000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    };
    const triggers1 = evaluateHumanGateTriggers(dummyJob, ni1, undefined, undefined);
    expect(triggers1.some(t => t.trigger_id === 'HGT_01')).toBe(true);

    const ni2: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 50000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    };
    const triggers2 = evaluateHumanGateTriggers(dummyJob, ni2, undefined, undefined);
    expect(triggers2.some(t => t.trigger_id === 'HGT_01')).toBe(false);
  });

  it('evaluates CostGuard HIGH/CRITICAL band trigger (HGT_02)', () => {
    const validation: SctValidationResult = {
      validation_id: 'v1', job_id: 'j1', sct_trace_id: 't1', cf_mcp_tool_calls: [],
      type_b_results: [], rate_checks: [], evidence_requirements: [],
      costguard_results: [{ line_id: 'l1', band: 'HIGH', verdict: 'ZERO', delta_pct: 10.0 }],
      doc_guardian_results: [], gate_results: [], confidence: 1.0, reason_codes: [], warnings: []
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, undefined, validation, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_02')).toBe(true);
  });

  it('evaluates Rate reference missing trigger (HGT_03)', () => {
    const ni: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 1000 },
      invoice_lines: [
        { line_id: 'l1', description: 'x', amount: 100, currency: 'AED', rate_status: 'UNKNOWN' }
      ],
      evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p1'
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, ni, undefined, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_03')).toBe(true);
  });

  it('evaluates Marine Closure missing evidence block trigger (HGT_05)', () => {
    const validation: SctValidationResult = {
      validation_id: 'v1', job_id: 'j1', sct_trace_id: 't1', cf_mcp_tool_calls: [],
      type_b_results: [], rate_checks: [], evidence_requirements: [], costguard_results: [],
      doc_guardian_results: [{ code: 'MOSB_EVIDENCE_MISSING', severity: 'ZERO' }],
      gate_results: [], confidence: 1.0, reason_codes: [], warnings: []
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, undefined, validation, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_05')).toBe(true);
  });

  it('evaluates Warehouse evidence missing trigger (HGT_06)', () => {
    const ni: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 1000 },
      invoice_lines: [
        { line_id: 'l1', description: 'x', amount: 100, currency: 'AED', for_charge_component: 'WAREHOUSE_STORAGE', evidence_status: 'MISSING' }
      ],
      evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p1'
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, ni, undefined, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_06')).toBe(true);
  });

  it('evaluates Compliance evidence missing trigger (HGT_07)', () => {
    const ni: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 1000 },
      invoice_lines: [
        { line_id: 'l1', description: 'x', amount: 100, currency: 'AED', evidence_status: 'MISSING' }
      ],
      evidence_candidates: [], parser_confidence: 0.99, parser_version: 'p1'
    };
    const validation: SctValidationResult = {
      validation_id: 'v1', job_id: 'j1', sct_trace_id: 't1', cf_mcp_tool_calls: [],
      type_b_results: [], rate_checks: [],
      evidence_requirements: [{ line_id: 'l1', required_evidence: ['COMPLIANCE'] }],
      costguard_results: [], doc_guardian_results: [], gate_results: [], confidence: 1.0, reason_codes: [], warnings: []
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, ni, validation, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_07')).toBe(true);
  });

  it('evaluates Low parser confidence trigger (HGT_08)', () => {
    const ni: NormalizedInvoice = {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 1000 },
      invoice_lines: [], evidence_candidates: [],
      parser_confidence: 0.90,
      parser_version: 'p1'
    };
    const triggers = evaluateHumanGateTriggers(dummyJob, ni, undefined, undefined);
    expect(triggers.some(t => t.trigger_id === 'HGT_08')).toBe(true);
  });
});
