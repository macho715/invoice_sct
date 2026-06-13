import { describe, it, expect } from 'vitest';
import { bandToVerdict, buildGateResult, type CostGuardLine } from '../src/lib/gate-bridge';

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
});
