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

  if (verdict === 'ZERO' && exportType === 'FINAL_APPROVED') {
    return {
      allowed: false,
      export_type: 'FINAL_APPROVED',
      reason: 'ZERO verdict blocks final approved export. Only review pack is permitted.',
      required_approver_role: null,
      error_code: 'ZERO_BLOCKED'
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
      return {
        allowed: false,
        export_type: 'FINAL_APPROVED',
        reason: 'AMBER verdict requires reviewer approval before final approved export.',
        required_approver_role: getRequiredApproverRole(varianceAed),
        error_code: 'APPROVAL_REQUIRED'
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
