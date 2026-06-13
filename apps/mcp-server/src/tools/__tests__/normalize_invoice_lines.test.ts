import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '../normalize_invoice_lines.js';

describe('normalize_invoice_lines', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('normalize_invoice_lines');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('infers TRANSPORT charge code and TEU unit from description', async () => {
    const result = await run({
      lines: [
        { line_id: 'L1', description: 'Ocean freight charges', qty: 2, rate: 500, amount: 1000, currency: 'USD' }
      ]
    });

    expect(result.normalized_lines).toHaveLength(1);
    expect(result.normalized_lines[0].charge_code).toBe('TRANSPORT');
    expect(result.normalized_lines[0].unit).toBe('TEU');
    expect(result.rejected_count).toBe(0);
  });

  it('infers DEMURRAGE charge code from "dem" keyword', async () => {
    const result = await run({
      lines: [
        { line_id: 'L2', description: 'DEM charges at port', qty: 5, rate: 100, amount: 500, currency: 'AED' }
      ]
    });

    expect(result.normalized_lines[0].charge_code).toBe('DEMURRAGE');
    expect(result.normalized_lines[0].unit).toBe('LS');
  });

  it('infers HANDLING charge code and LIFT unit', async () => {
    const result = await run({
      lines: [
        { line_id: 'L3', description: 'Crane loading at Jebel Ali', qty: 10, rate: 50, amount: 500, currency: 'AED' }
      ]
    });

    expect(result.normalized_lines[0].charge_code).toBe('HANDLING');
    expect(result.normalized_lines[0].unit).toBe('LIFT');
  });

  it('defaults to GENERAL charge code and LS unit for unrecognized descriptions', async () => {
    const result = await run({
      lines: [
        { line_id: 'L4', description: 'Miscellaneous service fee', qty: 1, rate: 200, amount: 200, currency: 'USD' }
      ]
    });

    expect(result.normalized_lines[0].charge_code).toBe('GENERAL');
    expect(result.normalized_lines[0].unit).toBe('LS');
  });

  it('counts rejected lines where both qty and rate are null', async () => {
    const result = await run({
      lines: [
        { line_id: 'L5', description: 'Transport fee', qty: null, rate: null, amount: 0, currency: 'AED' },
        { line_id: 'L6', description: 'Another line', qty: null, rate: null, amount: 0, currency: 'AED' },
        { line_id: 'L7', description: 'Valid line', qty: 1, rate: 100, amount: 100, currency: 'USD' }
      ]
    });

    expect(result.rejected_count).toBe(2);
    expect(result.normalized_lines).toHaveLength(3);
  });

  it('does not reject lines where only qty is null', async () => {
    const result = await run({
      lines: [
        { line_id: 'L8', description: 'Freight charge', qty: null, rate: 500, amount: 500, currency: 'USD' }
      ]
    });

    expect(result.rejected_count).toBe(0);
  });

  it('infers CUSTOMS charge code from "clearance" keyword', async () => {
    const result = await run({
      lines: [
        { line_id: 'L9', description: 'Customs clearance fee', qty: 1, rate: 300, amount: 300, currency: 'AED' }
      ]
    });

    expect(result.normalized_lines[0].charge_code).toBe('CUSTOMS');
  });

  it('infers INSURANCE charge code', async () => {
    const result = await run({
      lines: [
        { line_id: 'L10', description: 'Cargo insurance premium', qty: 1, rate: 150, amount: 150, currency: 'USD' }
      ]
    });

    expect(result.normalized_lines[0].charge_code).toBe('INSURANCE');
  });

  it('passes through qty, rate, amount, currency unchanged', async () => {
    const result = await run({
      lines: [
        { line_id: 'L11', description: 'Storage at warehouse', qty: 3, rate: 75.5, amount: 226.5, currency: 'AED' }
      ]
    });

    const line = result.normalized_lines[0];
    expect(line.qty).toBe(3);
    expect(line.rate).toBe(75.5);
    expect(line.amount).toBe(226.5);
    expect(line.currency).toBe('AED');
    expect(line.charge_code).toBe('STORAGE');
  });
});
