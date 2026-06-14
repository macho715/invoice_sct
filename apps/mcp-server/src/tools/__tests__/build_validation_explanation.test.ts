import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/build_validation_explanation';

describe('build_validation_explanation', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('build_validation_explanation');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns correct explanation for DUPLICATE_INVOICE', async () => {
    const result = await run({
      finding_id: 'F1',
      rule_id: 'R001',
      reason_code: 'DUPLICATE_INVOICE',
      line_id: 'L1',
      severity: 'ZERO'
    });
    expect(result.explanation).toContain('duplicate');
    expect(result.recommended_action).toContain('cannot be approved');
    expect(result.reviewer_hint).toContain('Contract/Admin');
  });

  it('returns correct explanation for VAT_RATE_MISMATCH', async () => {
    const result = await run({
      finding_id: 'F2',
      rule_id: 'R002',
      reason_code: 'VAT_RATE_MISMATCH',
      line_id: 'L2',
      severity: 'ZERO'
    });
    expect(result.explanation).toContain('5% UAE VAT');
    expect(result.recommended_action).toContain('Review required');
  });

  it('returns AMBER-level action for COST_VARIANCE_EXCEEDS_2PCT', async () => {
    const result = await run({
      finding_id: 'F3',
      rule_id: 'R003',
      reason_code: 'COST_VARIANCE_EXCEEDS_2PCT',
      line_id: 'L3',
      severity: 'AMBER'
    });
    expect(result.explanation).toContain('2%');
    expect(result.recommended_action).toContain('Reviewer attention');
    expect(result.reviewer_hint).toContain('Ops Lead');
  });

  it('returns PASS-level action with null reviewer_hint', async () => {
    const result = await run({
      finding_id: 'F4',
      rule_id: 'R004',
      reason_code: 'DUPLICATE_INVOICE',
      line_id: null,
      severity: 'PASS'
    });
    expect(result.recommended_action).toBe('No action required.');
    expect(result.reviewer_hint).toBeNull();
  });

  it('falls back to default template for unknown reason_code', async () => {
    const result = await run({
      finding_id: 'F5',
      rule_id: 'R999',
      reason_code: 'UNKNOWN_CODE',
      line_id: 'L5',
      severity: 'AMBER'
    });
    expect(result.explanation).toContain('R999');
    expect(result.explanation).toContain('L5');
  });

  it('handles all known reason codes', async () => {
    const codes = [
      'DUPLICATE_INVOICE',
      'AMOUNT_MISMATCH',
      'RATE_VARIANCE',
      'RATE_NOT_FOUND',
      'CONTRACT_EXPIRED',
      'CONTRACT_NOT_FOUND',
      'VAT_RATE_MISMATCH',
      'EVIDENCE_MISSING',
      'QTY_X_RATE_MISMATCH',
      'COST_VARIANCE_EXCEEDS_2PCT'
    ];
    for (const code of codes) {
      const result = await run({
        finding_id: 'F',
        rule_id: 'R',
        reason_code: code,
        line_id: 'L',
        severity: 'AMBER'
      });
      expect(result.explanation).toBeTruthy();
      expect(result.explanation).not.toContain('Validation finding for rule');
    }
  });
});
