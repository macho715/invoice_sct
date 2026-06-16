import { randomUUID } from 'node:crypto';
import type { Verdict, WorkflowType } from './types';

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

export interface DuplicateFinding {
  vendor_hash: string;
  invoice_no_hash: string;
  severity: 'AMBER' | 'ZERO';
  reason_code: string;
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

export function checkReconciliation(invoiceTotal: number | null, lineAuditTotal: number, typeBTotal: number | null, workflowType: WorkflowType = 'SHIPMENT', tolerance: number = 0.01): { ok: boolean; verdict: Verdict; reason: string | null } {
  // DOMESTIC: KRW-based, use higher absolute tolerance (KRW 100 ≈ USD 0.07)
  const effectiveTolerance = workflowType === 'DOMESTIC' ? Math.max(tolerance, 100) : tolerance;
  if (invoiceTotal === null) return { ok: false, verdict: 'AMBER', reason: 'FINAL_SUBTOTAL_MISSING' };
  if (Math.abs(invoiceTotal - lineAuditTotal) > effectiveTolerance) return { ok: false, verdict: 'AMBER', reason: 'LINE_TOTAL_MISMATCH' };
  if (typeBTotal !== null && Math.abs(lineAuditTotal - typeBTotal) > effectiveTolerance) return { ok: false, verdict: 'ZERO', reason: 'TYPEB_TOTAL_MISMATCH' };
  return { ok: true, verdict: 'PASS', reason: null };
}

export function checkDlpExport(violations: Array<{ sheet: string; row: number; col: number; category: string; value: string }>): { verdict: Verdict; reason?: string; details?: number } {
  if (violations.length > 0) {
    return { verdict: 'ZERO' as Verdict, reason: 'DLP_HIT_IN_EXPORT', details: violations.length };
  }
  return { verdict: 'PASS' as Verdict };
}

export interface DomesticLaneResult {
  line_id: string;
  lane: string | null;
  distance_km: number | null;
  rate_band: string;
  verdict: string;
  reason_code: string | null;
  delta_pct: number | null;
  cg_band: string;
  short_run_flag: boolean;
  fixed_cost_suspect: boolean;
  risk_score: number | null;
  rbr_trigger: boolean;
}

export function buildGateResult(jobId: string, lines: CostGuardLine[], evidenceFindings: EvidenceFinding[] = [], duplicateFindings: DuplicateFinding[] = [], workflowType: WorkflowType = 'SHIPMENT', domesticLaneResults: DomesticLaneResult[] = []) {
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
      required_action: lr.verdict === 'ZERO'
        ? (workflowType === 'DOMESTIC' ? '보류 + 국내물류팀 승인 필요' : 'Hold + Finance approval')
        : (workflowType === 'DOMESTIC' ? '국내물류 원가검토' : 'Review by Cost Control Lead')
    }));

  for (const ef of evidenceFindings) {
    if (!ef.line_id) {
      action_items.push({
        action_id: `act_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        severity: ef.severity,
        line_id: '',
        issue_type: `EVIDENCE_${ef.code}`,
        required_action: ef.severity === 'ZERO'
          ? (workflowType === 'DOMESTIC' ? '증빙 누락 — 보류 + 국내물류팀 검토' : 'Evidence gap — hold + Admin review')
          : (workflowType === 'DOMESTIC' ? '증빙 누락 — 운영팀 검토' : 'Evidence gap — review by Ops Lead')
      });
      if (ef.severity === 'ZERO' && verdict !== 'ZERO') {
        action_items[action_items.length - 1].severity = 'ZERO';
      }
    }
  }

  for (const dup of duplicateFindings) {
    action_items.push({
      action_id: `act_dup_${dup.invoice_no_hash.slice(0, 10)}`,
      severity: dup.severity,
      line_id: '',
      issue_type: dup.reason_code,
      required_action: dup.severity === 'ZERO'
        ? (workflowType === 'DOMESTIC' ? '중복 청구 감지 — 지급 보류 및 국내물류팀 승인 필요' : 'Duplicate invoice detected — hold payment and Finance approval required')
        : (workflowType === 'DOMESTIC' ? '중복 청구 의심 — 이전 청구 기록 확인' : 'Potential duplicate invoice — review prior invoice records')
    });
  }

  // Domestic lane check findings — add action items for short-run, fixed-cost, missing lanes, and rate variance
  for (const dl of domesticLaneResults) {
    if (dl.reason_code) {
      let requiredAction: string;
      if (dl.reason_code.includes('DOMESTIC_LANE_MISSING')) {
        requiredAction = '국내 Lane 정보 누락 — Lane Master 업데이트 필요';
      } else if (dl.reason_code.includes('SHORT_RUN')) {
        requiredAction = `단거리 운행(≤10km) 감지 — ${dl.distance_km?.toFixed(1) ?? '?'}km. 고정비 기준 검토 필요`;
      } else if (dl.reason_code.includes('FIXED_SUSPECT')) {
        requiredAction = `초단거리 운행(≤2km) 의심 — ${dl.distance_km?.toFixed(1) ?? '?'}km. 단가 적정성 검증`;
      } else if (dl.reason_code.includes('RATE_CRITICAL')) {
        requiredAction = `국내 운임 차이 과다(${dl.delta_pct?.toFixed(1) ?? '?'} %) — 원가검토 및 승인 필요`;
      } else if (dl.reason_code.includes('RATE_HIGH')) {
        requiredAction = `국내 운임 차이(${dl.delta_pct?.toFixed(1) ?? '?'} %) — 국내물류팀 검토`;
      } else {
        requiredAction = '국내 Lane 검증 이슈 — 국내물류팀 확인';
      }
      const severity: Verdict = dl.verdict === 'ZERO' ? 'ZERO' : 'AMBER';
      action_items.push({
        action_id: `act_dl_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        severity,
        line_id: dl.line_id,
        issue_type: dl.reason_code,
        required_action: requiredAction
      });
    }
  }

  const evidenceMax: Verdict = evidenceFindings.length > 0
    ? evidenceFindings.reduce<Verdict>((acc, ef) => (VERDICT_RANK[ef.severity] > VERDICT_RANK[acc] ? ef.severity : acc), 'PASS')
    : 'PASS';
  const duplicateMax: Verdict = duplicateFindings.length > 0
    ? duplicateFindings.reduce<Verdict>((acc, dup) => (VERDICT_RANK[dup.severity] > VERDICT_RANK[acc] ? dup.severity : acc), 'PASS')
    : 'PASS';
  const domesticMax: Verdict = domesticLaneResults.length > 0
    ? domesticLaneResults.reduce<Verdict>((acc, dl) => {
        const dlVerdict: Verdict = dl.verdict === 'ZERO' ? 'ZERO' : (dl.verdict === 'AMBER' ? 'AMBER' : 'PASS');
        return VERDICT_RANK[dlVerdict] > VERDICT_RANK[acc] ? dlVerdict : acc;
      }, 'PASS' as Verdict)
    : 'PASS';
  let finalVerdict: Verdict = VERDICT_RANK[evidenceMax] > VERDICT_RANK[verdict] ? evidenceMax : verdict;
  finalVerdict = VERDICT_RANK[duplicateMax] > VERDICT_RANK[finalVerdict] ? duplicateMax : finalVerdict;
  finalVerdict = VERDICT_RANK[domesticMax] > VERDICT_RANK[finalVerdict] ? domesticMax : finalVerdict;

  return { gate_id: `gate_${randomUUID().replace(/-/g, '').slice(0, 10)}`, job_id: jobId, verdict: finalVerdict, line_results, action_items };
}
