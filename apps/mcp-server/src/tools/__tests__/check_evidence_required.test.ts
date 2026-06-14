import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/check_evidence_required';

describe('check_evidence_required', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_evidence_required');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns ZERO with 3 required docs for TRANSPORT', async () => {
    const result = await run({ line_id: 'L1', charge_code: 'TRANSPORT', sct_code: null, present_evidence: [] });
    expect(result.verdict).toBe('ZERO');
    expect(result.required_evidence).toEqual(['BL', 'DN', 'PO']);
    expect(result.missing_evidence).toEqual(['BL', 'DN', 'PO']);
    expect(result.present_evidence).toEqual([]);
  });

  it('returns AMBER for INSURANCE (1 required doc)', async () => {
    const result = await run({ line_id: 'L2', charge_code: 'INSURANCE', sct_code: null, present_evidence: [] });
    expect(result.verdict).toBe('AMBER');
    expect(result.required_evidence).toEqual(['INSURANCE_CERT']);
    expect(result.missing_evidence).toEqual(['INSURANCE_CERT']);
  });

  it('falls back to GENERAL for unknown charge_code', async () => {
    const result = await run({ line_id: 'L3', charge_code: 'UNKNOWN_CODE', sct_code: null, present_evidence: [] });
    expect(result.verdict).toBe('ZERO');
    expect(result.required_evidence).toEqual(['DN', 'PO']);
  });

  it('returns ZERO for DEMURRAGE (3 required)', async () => {
    const result = await run({ line_id: 'L4', charge_code: 'DEMURRAGE', sct_code: null, present_evidence: [] });
    expect(result.verdict).toBe('ZERO');
    expect(result.required_evidence).toEqual(['BL', 'DN', 'DEM_DET_CALC']);
  });

  it('returns ZERO for STORAGE (2 required)', async () => {
    const result = await run({ line_id: 'L5', charge_code: 'STORAGE', sct_code: null, present_evidence: [] });
    expect(result.verdict).toBe('ZERO');
    expect(result.required_evidence).toEqual(['DN', 'WAREHOUSE_RECEIPT']);
  });

  it('returns AMBER when some but not all evidence is present', async () => {
    const result = await run({ line_id: 'L6', charge_code: 'STORAGE', sct_code: null, present_evidence: ['DN'] });
    expect(result.verdict).toBe('AMBER');
    expect(result.present_evidence).toEqual(['DN']);
    expect(result.missing_evidence).toEqual(['WAREHOUSE_RECEIPT']);
  });

  it('returns PASS when all required evidence is present', async () => {
    const result = await run({ line_id: 'L7', charge_code: 'TRANSPORT', sct_code: null, present_evidence: ['BL', 'DN', 'PO'] });
    expect(result.verdict).toBe('PASS');
    expect(result.present_evidence).toEqual(['BL', 'DN', 'PO']);
    expect(result.missing_evidence).toEqual([]);
  });
});
