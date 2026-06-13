import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '../check_tax_vat.js';

describe('check_tax_vat', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_tax_vat');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns PASS for correct 5% VAT on AED', async () => {
    const result = await run({ line_id: 'L1', amount: 1000, currency: 'AED', vat_rate: 0.05 });
    expect(result.verdict).toBe('PASS');
    expect(result.expected_vat).toBe(50);
    expect(result.applied_vat).toBe(50);
    expect(result.reason_code).toBeNull();
  });

  it('returns PASS with FX_VAT_CHECK_REQUIRED for USD at 5%', async () => {
    const result = await run({ line_id: 'L2', amount: 500, currency: 'USD', vat_rate: 0.05 });
    expect(result.verdict).toBe('PASS');
    expect(result.reason_code).toBe('FX_VAT_CHECK_REQUIRED');
  });

  it('returns AMBER when vat_rate is null', async () => {
    const result = await run({ line_id: 'L3', amount: 2000, currency: 'AED', vat_rate: null });
    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('VAT_RATE_NOT_SPECIFIED');
    expect(result.expected_vat).toBe(100);
    expect(result.applied_vat).toBeNull();
  });

  it('returns ZERO for wrong VAT rate (10%)', async () => {
    const result = await run({ line_id: 'L4', amount: 1000, currency: 'AED', vat_rate: 0.10 });
    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('VAT_RATE_MISMATCH');
    expect(result.expected_vat).toBe(50);
    expect(result.applied_vat).toBe(100);
  });

  it('returns AMBER for VAT_ROUNDING (tiny difference within 0.01)', async () => {
    const amount = 1000;
    const expectedVat = amount * 0.05;
    const tinyOffset = 0.005 / amount;
    const result = await run({
      line_id: 'L5',
      amount,
      currency: 'AED',
      vat_rate: 0.05 + tinyOffset
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('VAT_ROUNDING');
  });
});
