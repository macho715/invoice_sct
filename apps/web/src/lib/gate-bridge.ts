import { randomUUID } from 'node:crypto';
import type { Verdict } from './types';

export type CostGuardBand = 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL';

export interface CostGuardLine {
  line_id: string;
  band: CostGuardBand;
  delta_pct: number | null;
  reason_codes: string[];
}

export interface EvidenceFinding {
  line_id: string | null;
  code: string;
  severity: 'AMBER' | 'ZERO';
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

export function checkReconciliation(invoiceTotal: number | null, lineAuditTotal: number, typeBTotal: number | null, tolerance: number = 0.01): { ok: boolean; verdict: Verdict; reason: string | null } {
  if (invoiceTotal === null) return { ok: false, verdict: 'AMBER', reason: 'FINAL_SUBTOTAL_MISSING' };
  if (Math.abs(invoiceTotal - lineAuditTotal) > tolerance) return { ok: false, verdict: 'AMBER', reason: 'LINE_TOTAL_MISMATCH' };
  if (typeBTotal !== null && Math.abs(lineAuditTotal - typeBTotal) > tolerance) return { ok: false, verdict: 'ZERO', reason: 'TYPEB_TOTAL_MISMATCH' };
  return { ok: true, verdict: 'PASS', reason: null };
}

export function checkDlpExport(violations: Array<{ sheet: string; row: number; col: number; category: string; value: string }>): { verdict: Verdict; reason?: string; details?: number } {
  if (violations.length > 0) {
    return { verdict: 'ZERO' as Verdict, reason: 'DLP_HIT_IN_EXPORT', details: violations.length };
  }
  return { verdict: 'PASS' as Verdict };
}

export function buildGateResult(jobId: string, lines: CostGuardLine[], evidenceFindings: EvidenceFinding[] = []) {
  const line_results = lines.map(l => ({
    line_id: l.line_id,
    verdict: bandToVerdict(l.band),
    band: l.band,
    delta_pct: l.delta_pct,
    reason_codes: l.reason_codes
  }));

  for (const ef of evidenceFindings) {
    if (ef.line_id) {
      const existing = line_results.find(lr => lr.line_id === ef.line_id);
      if (existing) {
        existing.reason_codes.push(`EVIDENCE_${ef.code}`);
        const evVerdict: Verdict = ef.severity === 'ZERO' ? 'ZERO' : 'AMBER';
        if (VERDICT_RANK[evVerdict] > VERDICT_RANK[existing.verdict]) {
          existing.verdict = evVerdict;
        }
      }
    }
  }

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
      required_action: lr.verdict === 'ZERO' ? 'Hold + Finance approval' : 'Review by Cost Control Lead'
    }));

  for (const ef of evidenceFindings) {
    if (!ef.line_id) {
      action_items.push({
        action_id: `act_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        severity: ef.severity,
        line_id: '',
        issue_type: `EVIDENCE_${ef.code}`,
        required_action: ef.severity === 'ZERO' ? 'Evidence gap — hold + Admin review' : 'Evidence gap — review by Ops Lead'
      });
      if (ef.severity === 'ZERO' && verdict !== 'ZERO') {
        action_items[action_items.length - 1].severity = 'ZERO';
      }
    }
  }

  const evidenceMax: Verdict = evidenceFindings.length > 0
    ? evidenceFindings.reduce<Verdict>((acc, ef) => (VERDICT_RANK[ef.severity] > VERDICT_RANK[acc] ? ef.severity : acc), 'PASS')
    : 'PASS';
  const finalVerdict: Verdict = VERDICT_RANK[evidenceMax] > VERDICT_RANK[verdict] ? evidenceMax : verdict;

  return { gate_id: `gate_${randomUUID().replace(/-/g, '').slice(0, 10)}`, job_id: jobId, verdict: finalVerdict, line_results, action_items };
}
