import { describe, it, expect } from 'vitest';
import { evaluateApprovalGate, getRequiredApproverRole } from '../src/lib/approval-gate';

describe('evaluateApprovalGate', () => {
  it('PASS verdict allows FINAL_APPROVED export', () => {
    const result = evaluateApprovalGate({
      verdict: 'PASS',
      approval: null,
      exportType: 'FINAL_APPROVED'
    });
    expect(result.allowed).toBe(true);
    expect(result.export_type).toBe('FINAL_APPROVED');
  });

  it('ZERO verdict still delivers FINAL_APPROVED export (Rule #1, labeled in workbook)', () => {
    const result = evaluateApprovalGate({
      verdict: 'ZERO',
      approval: null,
      exportType: 'FINAL_APPROVED'
    });
    expect(result.allowed).toBe(true);
    expect(result.error_code).toBe(null);
  });

  it('ZERO verdict allows REVIEW_PACK export', () => {
    const result = evaluateApprovalGate({
      verdict: 'ZERO',
      approval: null,
      exportType: 'REVIEW_PACK'
    });
    expect(result.allowed).toBe(true);
    expect(result.export_type).toBe('REVIEW_PACK');
  });

  it('AMBER without approval still delivers FINAL_APPROVED (Rule #1); approver role surfaced for labeling', () => {
    const result = evaluateApprovalGate({
      verdict: 'AMBER',
      approval: null,
      exportType: 'FINAL_APPROVED'
    });
    expect(result.allowed).toBe(true);
    expect(result.error_code).toBe(null);
    expect(result.required_approver_role).toBe('OPS_LEAD');
  });

  it('FAILED verdict stays blocked (validation could not run — no deliverable)', () => {
    const result = evaluateApprovalGate({
      verdict: 'FAILED',
      approval: null,
      exportType: 'FINAL_APPROVED'
    });
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe('VALIDATION_FAILED');
  });

  it('AMBER with approval allows FINAL_APPROVED', () => {
    const result = evaluateApprovalGate({
      verdict: 'AMBER',
      approval: {
        approval_id: 'apr_001',
        job_id: 'job_001',
        status: 'APPROVED' as const,
        approved_by: 'FINANCE_APPROVER',
        approved_at: '2026-06-13T00:00:00Z',
        approval_scope: 'AMBER_ACK' as const,
        acknowledgement_reason: null,
        prism_kernel_proof_ref: 'proof_001',
        triggers: []
      },
      exportType: 'FINAL_APPROVED'
    });
    expect(result.allowed).toBe(true);
  });

  it('AMBER without approval allows REVIEW_PACK', () => {
    const result = evaluateApprovalGate({
      verdict: 'AMBER',
      approval: null,
      exportType: 'REVIEW_PACK'
    });
    expect(result.allowed).toBe(true);
    expect(result.export_type).toBe('REVIEW_PACK');
  });
});

describe('getRequiredApproverRole', () => {
  it('returns OPS_LEAD for variance < 500', () => {
    expect(getRequiredApproverRole(499)).toBe('OPS_LEAD');
  });

  it('returns FINANCE_APPROVER for variance >= 500', () => {
    expect(getRequiredApproverRole(500)).toBe('FINANCE_APPROVER');
    expect(getRequiredApproverRole(1000)).toBe('FINANCE_APPROVER');
  });
});
