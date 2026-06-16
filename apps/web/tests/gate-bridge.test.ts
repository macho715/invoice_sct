import { describe, it, expect } from 'vitest';
import { bandToVerdict, buildGateResult, type CostGuardLine, type EvidenceFinding } from '../src/lib/gate-bridge';

describe('gate-bridge', () => {
  it('bandToVerdict: PASS->PASS, WARN->AMBER, HIGH->ZERO, CRITICAL->ZERO', () => {
    expect(bandToVerdict('PASS')).toBe('PASS');
    expect(bandToVerdict('WARN')).toBe('AMBER');
    expect(bandToVerdict('HIGH')).toBe('ZERO');
    expect(bandToVerdict('CRITICAL')).toBe('ZERO');
  });

  it('buildGateResult: job verdict = max severity across lines (PASS < AMBER < ZERO < FAILED)', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 1.0, reason_codes: [] },
      { line_id: 'l2', band: 'WARN', delta_pct: 3.0, reason_codes: ['COST_VARIANCE_WARN'] },
      { line_id: 'l3', band: 'HIGH', delta_pct: 7.0, reason_codes: ['COSTGUARD_BAND_HIGH'] }
    ];
    const r = buildGateResult('job_1', lines);
    expect(r.verdict).toBe('ZERO');
    expect(r.line_results).toHaveLength(3);
    expect(r.line_results[0].verdict).toBe('PASS');
    expect(r.line_results[1].verdict).toBe('AMBER');
    expect(r.line_results[2].verdict).toBe('ZERO');
    expect(r.action_items.some(a => a.issue_type === 'COSTGUARD_BAND_HIGH')).toBe(true);
  });

  it('buildGateResult: empty lines => verdict PASS, no action items', () => {
    const r = buildGateResult('job_1', []);
    expect(r.verdict).toBe('PASS');
    expect(r.action_items).toEqual([]);
  });

  it('evidence: empty evidence findings => costguard-only verdict (regression guard)', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 1.0, reason_codes: [] },
      { line_id: 'l2', band: 'WARN', delta_pct: 3.0, reason_codes: ['COST_VARIANCE_WARN'] }
    ];
    const r = buildGateResult('job_1', lines, []);
    expect(r.verdict).toBe('AMBER');
    expect(r.line_results).toHaveLength(2);
  });

  it('evidence: ZERO evidence finding on a PASS line upgrades verdict to ZERO', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 1.0, reason_codes: [] }
    ];
    const evidence: EvidenceFinding[] = [
      { line_id: 'l1', code: 'MISSING_BOL', severity: 'ZERO' }
    ];
    const r = buildGateResult('job_1', lines, evidence);
    expect(r.verdict).toBe('ZERO');
    expect(r.line_results[0].verdict).toBe('ZERO');
    expect(r.line_results[0].reason_codes).toContain('EVIDENCE_MISSING_BOL');
  });

  it('evidence: AMBER evidence + WARN costguard => AMBER verdict', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 0.5, reason_codes: [] },
      { line_id: 'l2', band: 'WARN', delta_pct: 3.0, reason_codes: ['COST_VARIANCE_WARN'] }
    ];
    const evidence: EvidenceFinding[] = [
      { line_id: 'l2', code: 'PARTIAL_EVIDENCE', severity: 'AMBER' }
    ];
    const r = buildGateResult('job_1', lines, evidence);
    expect(r.verdict).toBe('AMBER');
  });

  it('evidence: header-level (line_id null) ZERO finding creates action item', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 1.0, reason_codes: [] }
    ];
    const evidence: EvidenceFinding[] = [
      { line_id: null, code: 'MISSING_HEADER_DOC', severity: 'ZERO' }
    ];
    const r = buildGateResult('job_1', lines, evidence);
    expect(r.verdict).toBe('ZERO');
    expect(r.action_items.some(a => a.issue_type === 'EVIDENCE_MISSING_HEADER_DOC')).toBe(true);
  });
});

it('duplicate: ZERO duplicate finding upgrades job verdict and creates action item', () => {
  const lines: CostGuardLine[] = [
    { line_id: 'l1', band: 'PASS', delta_pct: 0, reason_codes: [] }
  ];
  const r = buildGateResult('job_1', lines, [], [{
    vendor_hash: 'v'.repeat(64),
    invoice_no_hash: 'i'.repeat(64),
    severity: 'ZERO',
    reason_code: 'DUPLICATE_INVOICE'
  }]);
  expect(r.verdict).toBe('ZERO');
  expect(r.action_items.some(a => a.issue_type === 'DUPLICATE_INVOICE' && a.severity === 'ZERO')).toBe(true);
});
