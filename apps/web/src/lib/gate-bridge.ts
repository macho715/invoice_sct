import { randomUUID } from 'node:crypto';
import type { Verdict } from './types';

export type CostGuardBand = 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL';

export interface CostGuardLine {
  line_id: string;
  band: CostGuardBand;
  delta_pct: number | null;
  reason_codes: string[];
}

const VERDICT_RANK: Record<Verdict, number> = { PASS: 0, AMBER: 1, ZERO: 2, FAILED: 3 };

export function bandToVerdict(band: CostGuardBand): Verdict {
  switch (band) {
    case 'PASS': return 'PASS';
    case 'WARN': return 'AMBER';
    case 'HIGH':
    case 'CRITICAL': return 'ZERO';
  }
}

export function buildGateResult(jobId: string, lines: CostGuardLine[]) {
  const line_results = lines.map(l => ({
    line_id: l.line_id,
    verdict: bandToVerdict(l.band),
    band: l.band,
    delta_pct: l.delta_pct,
    reason_codes: l.reason_codes
  }));
  const verdict: Verdict = line_results.reduce<Verdict>(
    (acc, lr) => (VERDICT_RANK[lr.verdict] > VERDICT_RANK[acc] ? lr.verdict : acc),
    'PASS'
  );
  const action_items = line_results
    .filter(lr => lr.verdict !== 'PASS')
    .map(lr => ({
      action_id: `act_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      severity: lr.verdict as Verdict,
      line_id: lr.line_id,
      issue_type: lr.reason_codes[0] ?? 'COSTGUARD_NONPASS',
      required_action: lr.verdict === 'AMBER' ? 'Review by Cost Control Lead' : 'Hold + Finance approval'
    }));
  return { gate_id: `gate_${randomUUID().replace(/-/g, '').slice(0, 10)}`, job_id: jobId, verdict, line_results, action_items };
}
