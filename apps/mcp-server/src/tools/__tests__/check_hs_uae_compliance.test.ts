import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/check_hs_uae_compliance';

describe('check_hs_uae_compliance', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_hs_uae_compliance');
    expect(TOOL_VERSION).toBe('0.1.0');
  });

  it('returns PASS for non-CUSTOMS charge_code (not applicable)', async () => {
    const result = await run({
      line_id: 'L1',
      charge_code: 'TRANSPORT',
      hs_code: null,
      evidence_docs: []
    });
    expect(result.verdict).toBe('PASS');
    expect(result.boe_found).toBe(false);
    expect(result.hs_code_valid).toBeNull();
    expect(result.reason_code).toBeNull();
  });

  it('returns ZERO for CUSTOMS with no BOE evidence', async () => {
    const result = await run({
      line_id: 'L2',
      charge_code: 'CUSTOMS',
      hs_code: null,
      evidence_docs: ['DN', 'PO']
    });
    expect(result.verdict).toBe('ZERO');
    expect(result.boe_found).toBe(false);
    expect(result.hs_code_valid).toBeNull();
    expect(result.reason_code).toBe('CUSTOMS_BOE_MISSING');
  });

  it('returns AMBER for CUSTOMS with BOE but no HS code', async () => {
    const result = await run({
      line_id: 'L3',
      charge_code: 'CUSTOMS',
      hs_code: null,
      evidence_docs: ['BOE', 'DN']
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.boe_found).toBe(true);
    expect(result.hs_code_valid).toBeNull();
    expect(result.reason_code).toBe('CUSTOMS_HS_CODE_MISSING');
  });

  it('returns PASS for CUSTOMS with BOE + valid HS code with dots (8471.30)', async () => {
    const result = await run({
      line_id: 'L4',
      charge_code: 'CUSTOMS',
      hs_code: '8471.30',
      evidence_docs: ['BOE']
    });
    expect(result.verdict).toBe('PASS');
    expect(result.boe_found).toBe(true);
    expect(result.hs_code_valid).toBe(true);
    expect(result.reason_code).toBeNull();
  });

  it('returns PASS for CUSTOMS with BOE + valid HS code without dots (847130)', async () => {
    const result = await run({
      line_id: 'L5',
      charge_code: 'CUSTOMS',
      hs_code: '847130',
      evidence_docs: ['BOE']
    });
    expect(result.verdict).toBe('PASS');
    expect(result.boe_found).toBe(true);
    expect(result.hs_code_valid).toBe(true);
    expect(result.reason_code).toBeNull();
  });

  it('returns AMBER for CUSTOMS with BOE + invalid HS code (abc123)', async () => {
    const result = await run({
      line_id: 'L6',
      charge_code: 'CUSTOMS',
      hs_code: 'abc123',
      evidence_docs: ['BOE']
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.boe_found).toBe(true);
    expect(result.hs_code_valid).toBe(false);
    expect(result.reason_code).toBe('CUSTOMS_HS_CODE_INVALID');
  });

  it('detects BOE when evidence_docs contains Bill of Entry', async () => {
    const result = await run({
      line_id: 'L7',
      charge_code: 'CUSTOMS',
      hs_code: '8471.30',
      evidence_docs: ['DN', 'Bill of Entry']
    });
    expect(result.verdict).toBe('PASS');
    expect(result.boe_found).toBe(true);
  });
});
