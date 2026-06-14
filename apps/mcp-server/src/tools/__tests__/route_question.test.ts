import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/route_question';

describe('route_question', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('route_question');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('routes "duplicate" keyword to check_duplicate_invoice with 0.9 confidence', async () => {
    const result = await run({ question: 'Is this a duplicate invoice?', userRole: 'ops' });
    expect(result.routed_to).toBe('check_duplicate_invoice');
    expect(result.confidence).toBe(0.9);
  });

  it('routes "rate" keyword to check_rate_card', async () => {
    const result = await run({ question: 'Check the rate for this lane', userRole: 'ops' });
    expect(result.routed_to).toBe('check_rate_card');
    expect(result.confidence).toBe(0.85);
  });

  it('routes "vat" keyword to check_tax_vat with 0.9 confidence', async () => {
    const result = await run({ question: 'Verify the VAT calculation', userRole: 'ops' });
    expect(result.routed_to).toBe('check_tax_vat');
    expect(result.confidence).toBe(0.9);
  });

  it('routes "shipment" keyword to match_shipment_reference', async () => {
    const result = await run({ question: 'Match the shipment BL number', userRole: 'ops' });
    expect(result.routed_to).toBe('match_shipment_reference');
    expect(result.confidence).toBe(0.85);
  });

  it('routes unknown question to check_cost_guard with 0.5 confidence', async () => {
    const result = await run({ question: 'Something completely unrelated', userRole: 'ops' });
    expect(result.routed_to).toBe('check_cost_guard');
    expect(result.confidence).toBe(0.5);
    expect(result.rationale).toBe('Default route: cost guard analysis');
  });

  it('boosts confidence by 0.05 for finance role', async () => {
    const result = await run({ question: 'Is this a duplicate?', userRole: 'finance manager' });
    expect(result.routed_to).toBe('check_duplicate_invoice');
    expect(result.confidence).toBe(0.95);
  });

  it('boosts confidence by 0.05 for approver role', async () => {
    const result = await run({ question: 'Check the contract validity', userRole: 'approver' });
    expect(result.routed_to).toBe('check_contract_validity');
    expect(result.confidence).toBe(0.9);
  });

  it('caps confidence at 1.0 for finance role on high-confidence route', async () => {
    const result = await run({ question: 'Verify the TRN', userRole: 'finance' });
    expect(result.routed_to).toBe('check_tax_vat');
    expect(result.confidence).toBe(0.95);
  });

  it('routes "explain" keyword to build_validation_explanation', async () => {
    const result = await run({ question: 'Explain this finding', userRole: 'ops' });
    expect(result.routed_to).toBe('build_validation_explanation');
    expect(result.confidence).toBe(0.8);
  });

  it('routes "evidence" keyword to check_evidence_required', async () => {
    const result = await run({ question: 'Is the document proof sufficient?', userRole: 'ops' });
    expect(result.routed_to).toBe('check_evidence_required');
    expect(result.confidence).toBe(0.85);
  });

  it('routes "fx" keyword to check_fx_policy', async () => {
    const result = await run({ question: 'Check the currency conversion', userRole: 'ops' });
    expect(result.routed_to).toBe('check_fx_policy');
    expect(result.confidence).toBe(0.85);
  });
});
