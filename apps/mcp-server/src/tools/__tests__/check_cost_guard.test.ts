import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '../check_cost_guard.js';

describe('check_cost_guard', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_cost_guard');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns PASS when qty*rate matches draftAmount and standardAmount within 2%', async () => {
    const result = await run({
      invoiceNo: 'INV-001',
      currency: 'AED',
      lines: [
        {
          lineNo: '1',
          item: 'Transport',
          qty: 10,
          rate: 100,
          draftAmount: 1000,
          standardAmount: 990,
          currency: 'AED',
          evidenceIds: ['E1']
        }
      ]
    });
    expect(result.verdict).toBe('PASS');
    expect(result.line_findings).toHaveLength(1);
    expect(result.line_findings[0].qty_x_rate).toBe(1000);
    expect(result.line_findings[0].reason_code).toBeNull();
  });

  it('returns ZERO when qty*rate does not match draftAmount', async () => {
    const result = await run({
      invoiceNo: 'INV-002',
      currency: 'AED',
      lines: [
        {
          lineNo: '1',
          item: 'Transport',
          qty: 10,
          rate: 100,
          draftAmount: 1200,
          standardAmount: 1000,
          currency: 'AED',
          evidenceIds: []
        }
      ]
    });
    expect(result.verdict).toBe('ZERO');
    expect(result.line_findings[0].reason_code).toBe('QTY_X_RATE_MISMATCH');
  });

  it('returns AMBER when standard variance exceeds 2%', async () => {
    const result = await run({
      invoiceNo: 'INV-003',
      currency: 'USD',
      lines: [
        {
          lineNo: '1',
          item: 'Handling',
          qty: 5,
          rate: 200,
          draftAmount: 1000,
          standardAmount: 800,
          currency: 'USD',
          evidenceIds: ['E1']
        }
      ]
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.line_findings[0].reason_code).toBe('COST_VARIANCE_EXCEEDS_2PCT');
    expect(result.line_findings[0].variance_pct).toBe(25);
  });

  it('returns AMBER when standardAmount is null', async () => {
    const result = await run({
      invoiceNo: 'INV-004',
      currency: 'AED',
      lines: [
        {
          lineNo: '1',
          item: 'Storage',
          qty: 2,
          rate: 500,
          draftAmount: 1000,
          standardAmount: null,
          currency: 'AED',
          evidenceIds: []
        }
      ]
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.line_findings[0].reason_code).toBe('STANDARD_RATE_NOT_AVAILABLE');
  });

  it('returns ZERO if any line is ZERO even if others are PASS', async () => {
    const result = await run({
      invoiceNo: 'INV-005',
      currency: 'AED',
      lines: [
        {
          lineNo: '1',
          item: 'Transport',
          qty: 10,
          rate: 100,
          draftAmount: 1000,
          standardAmount: 990,
          currency: 'AED',
          evidenceIds: ['E1']
        },
        {
          lineNo: '2',
          item: 'Demurrage',
          qty: 3,
          rate: 200,
          draftAmount: 999,
          standardAmount: 600,
          currency: 'AED',
          evidenceIds: []
        }
      ]
    });
    expect(result.verdict).toBe('ZERO');
    expect(result.line_findings[0].reason_code).toBeNull();
    expect(result.line_findings[1].reason_code).toBe('QTY_X_RATE_MISMATCH');
  });
});
