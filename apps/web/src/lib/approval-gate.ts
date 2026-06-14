import type { Verdict, ApprovalRecord } from './types';

export type ExportType = 'FINAL_APPROVED' | 'REVIEW_PACK';

export interface ApprovalGateResult {
  allowed: boolean;
  export_type: ExportType;
  reason: string;
  required_approver_role: string | null;
  error_code: string | null;
}

export function getRequiredApproverRole(varianceAed: number): string {
  return varianceAed < 500 ? 'OPS_LEAD' : 'FINANCE_APPROVER';
}

export function evaluateApprovalGate(params: {
  verdict: Verdict;
  approval: ApprovalRecord | undefined | null;
  exportType: ExportType;
  varianceAed?: number;
}): ApprovalGateResult {
  const { verdict, approval, exportType, varianceAed = 0 } = params;

  // Rule #1 (CLAUDE.md §0): the final Excel deliverable is ALWAYS produced.
  // A ZERO verdict no longer withholds the export — the workbook stamps the
  // real ZERO verdict in 00_Decision and lists blocked/unverified items in
  // 01_Action_Items / 92_Evidence_Issues. Governance is by labeling inside the
  // deliverable, not by refusing to deliver it. (DLP masking still enforced at
  // scan time, and FAILED — validation could not run — stays blocked below.)
  if (verdict === 'ZERO' && exportType === 'FINAL_APPROVED') {
    return {
      allowed: true,
      export_type: 'FINAL_APPROVED',
      reason: 'ZERO verdict: final Excel delivered with blocked/unverified items labeled in the workbook (Rule #1).',
      required_approver_role: null,
      error_code: null
    };
  }

  if (verdict === 'ZERO' && exportType === 'REVIEW_PACK') {
    return {
      allowed: true,
      export_type: 'REVIEW_PACK',
      reason: 'Review pack export allowed for ZERO verdict.',
      required_approver_role: null,
      error_code: null
    };
  }

  if (verdict === 'AMBER' && exportType === 'FINAL_APPROVED') {
    if (!approval || approval.status !== 'APPROVED') {
      // Rule #1: deliver the final Excel even without prior approval. The
      // required approver role is still surfaced (for labeling / sign-off
      // tracking), but it no longer gates the download.
      return {
        allowed: true,
        export_type: 'FINAL_APPROVED',
        reason: 'AMBER verdict: final Excel delivered; reviewer approval is tracked as labeling, not a download gate (Rule #1).',
        required_approver_role: getRequiredApproverRole(varianceAed),
        error_code: null
      };
    }
    return {
      allowed: true,
      export_type: 'FINAL_APPROVED',
      reason: 'AMBER verdict with valid approval. Final approved export allowed.',
      required_approver_role: null,
      error_code: null
    };
  }

  if (verdict === 'AMBER' && exportType === 'REVIEW_PACK') {
    return {
      allowed: true,
      export_type: 'REVIEW_PACK',
      reason: 'Review pack export allowed for AMBER verdict without approval.',
      required_approver_role: null,
      error_code: null
    };
  }

  if (verdict === 'PASS') {
    return {
      allowed: true,
      export_type: exportType,
      reason: 'PASS verdict. Export allowed.',
      required_approver_role: null,
      error_code: null
    };
  }

  if (verdict === 'FAILED') {
    return {
      allowed: false,
      export_type: exportType,
      reason: 'FAILED verdict. Export blocked.',
      required_approver_role: null,
      error_code: 'VALIDATION_FAILED'
    };
  }

  return {
    allowed: false,
    export_type: exportType,
    reason: 'Unknown verdict. Export blocked.',
    required_approver_role: null,
    error_code: 'INVALID_STATE'
  };
}
