'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalVerdict = 'PASS' | 'AMBER' | 'ZERO';

export type ApproverRole =
  | 'COST_CONTROL_LEAD'
  | 'FINANCE_APPROVER'
  | 'MARINE_LEAD'
  | 'COMPLIANCE_LEAD'
  | 'WAREHOUSE_MANAGER'
  | 'DOCUMENT_CONTROLLER';

export interface ApprovalModalProps {
  jobId: string;
  verdict: ApprovalVerdict;
  /** Variance amount in AED (used for AMBER routing). */
  varianceAed?: number;
  /** Current user role (drives approver role display and which roles can submit). */
  approverRole?: ApproverRole;
  /** Pre-filled identity (e.g. from session). */
  approverIdentity?: string;
  onClose: () => void;
  onSubmit?: (result: { approvalId: string; prismKernelProofRef: string }) => void;
}

// Threshold from project rules: AMBER < 500 AED → Ops Lead, AMBER >= 500 AED → Finance Manager.
export const AMBER_FINANCE_THRESHOLD_AED = 500;

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

const ApprovalFormSchema = z
  .object({
    approverIdentity: z
      .string()
      .trim()
      .min(2, 'Approver identity is required (min 2 characters).'),
    comments: z.string().trim().max(2000, 'Comments must be 2000 characters or less.'),
    contractAdminAcknowledged: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.contractAdminAcknowledged) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractAdminAcknowledged'],
        message: 'Contract/Admin review acknowledgement is required for ZERO verdict.',
      });
    }
  });

export type ApprovalFormValues = z.infer<typeof ApprovalFormSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAed(amount: number | undefined): string {
  if (amount === undefined || Number.isNaN(amount)) return '0.00';
  return amount.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function requiredRoleForAmber(varianceAed: number | undefined): {
  label: string;
  role: ApproverRole;
  description: string;
} {
  const isHigh = (varianceAed ?? 0) >= AMBER_FINANCE_THRESHOLD_AED;
  if (isHigh) {
    return {
      label: 'Finance Manager approval required',
      role: 'FINANCE_APPROVER',
      description: `Variance ${formatAed(varianceAed)} AED >= ${AMBER_FINANCE_THRESHOLD_AED} AED threshold. Finance Manager must acknowledge.`,
    };
  }
  return {
    label: 'Ops Lead approval required',
    role: 'COST_CONTROL_LEAD',
    description: `Variance ${formatAed(varianceAed)} AED < ${AMBER_FINANCE_THRESHOLD_AED} AED threshold. Ops Lead acknowledgement is sufficient.`,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApprovalModal(props: ApprovalModalProps) {
  const {
    jobId,
    verdict,
    varianceAed,
    approverRole,
    approverIdentity: initialIdentity,
    onClose,
    onSubmit,
  } = props;

  const [approverIdentity, setApproverIdentity] = useState<string>(initialIdentity ?? '');
  const [comments, setComments] = useState<string>('');
  const [contractAdminAcknowledged, setContractAdminAcknowledged] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const amberInfo = useMemo(
    () => (verdict === 'AMBER' ? requiredRoleForAmber(varianceAed) : null),
    [verdict, varianceAed]
  );

  // Escape-to-close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, submitting]);

  // Focus management: focus first field on mount, restore on unmount
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Simple focus trap
  useEffect(() => {
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleTab);
    return () => window.removeEventListener('keydown', handleTab);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Disable submit until role allows it
  const roleAuthorized = useMemo(() => {
    if (verdict === 'PASS') return true;
    if (verdict === 'AMBER') {
      if (!approverRole) return true; // allow but server will validate
      if (!amberInfo) return true;
      return approverRole === amberInfo.role || approverRole === 'FINANCE_APPROVER';
    }
    if (verdict === 'ZERO') {
      if (!approverRole) return true; // allow but server will validate
      return (
        approverRole === 'FINANCE_APPROVER' ||
        approverRole === 'COMPLIANCE_LEAD' ||
        approverRole === 'MARINE_LEAD' ||
        approverRole === 'COST_CONTROL_LEAD'
      );
    }
    return false;
  }, [verdict, approverRole, amberInfo]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    setValidationError(null);

    const parsed = ApprovalFormSchema.safeParse({
      approverIdentity,
      comments,
      contractAdminAcknowledged: verdict === 'ZERO' ? contractAdminAcknowledged : true,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setValidationError(issue ? issue.message : 'Form validation failed.');
      return;
    }

    setSubmitting(true);
    try {
      const approvalScope = verdict === 'ZERO' ? 'ZERO_APPROVED' : 'AMBER_ACK';
      const res = await fetch('/api/audit/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': approverRole ?? 'COST_CONTROL_LEAD',
          'x-user-id': parsed.data.approverIdentity,
        },
        body: JSON.stringify({
          job_id: jobId,
          approval_scope: approvalScope,
          acknowledgement_reason: parsed.data.comments || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setServerError(
          body.message
            ? `${body.code ?? 'ERROR'}: ${body.message}`
            : `Server error (HTTP ${res.status})`
        );
        return;
      }
      const body = (await res.json()) as { approval_id: string; prism_kernel_proof_ref: string };
      onSubmit?.({ approvalId: body.approval_id, prismKernelProofRef: body.prism_kernel_proof_ref });
      onClose();
    } catch (err) {
      setServerError((err as Error).message || 'Unexpected error during approval.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExport() {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/audit/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setServerError(
          body.message
            ? `${body.code ?? 'ERROR'}: ${body.message}`
            : `Export failed (HTTP ${res.status})`
        );
        return;
      }
      onSubmit?.({ approvalId: '', prismKernelProofRef: '' });
      onClose();
    } catch (err) {
      setServerError((err as Error).message || 'Unexpected error during export.');
    } finally {
      setSubmitting(false);
    }
  }

  // Render the verdict-specific body
  function renderBody() {
    if (verdict === 'PASS') {
      return (
        <div className="space-y-4" data-testid="pass-body">
          <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white"
              >
                OK
              </span>
              <p className="font-semibold text-green-900">All validation checks passed</p>
            </div>
            <p className="mt-2 text-sm text-green-800">
              This job is ready to export as a <strong>Final Approved Workbook</strong>. No
              human-gate triggers are active.
            </p>
          </div>
          <p className="text-sm text-gray-700">
            Click <strong>Confirm &amp; Export Final Workbook</strong> to produce the signed
            13-sheet audit pack.
          </p>
        </div>
      );
    }

    if (verdict === 'AMBER' && amberInfo) {
      return (
        <div className="space-y-4" data-testid="amber-body">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="font-semibold text-amber-900">AMBER verdict — review required</p>
            <p className="mt-1 text-sm text-amber-800">
              Variance: <strong data-testid="variance-amount">{formatAed(varianceAed)} AED</strong>
            </p>
          </div>
          <div className="rounded-md border border-gray-300 bg-white px-4 py-3">
            <p className="text-sm font-medium text-gray-900" data-testid="amber-required-label">
              {amberInfo.label}
            </p>
            <p className="mt-1 text-xs text-gray-600">{amberInfo.description}</p>
            <p className="mt-2 text-xs text-gray-600">
              Current approver role:{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5" data-testid="current-role">
                {approverRole ?? '(not set)'}
              </code>
            </p>
          </div>
        </div>
      );
    }

    if (verdict === 'ZERO') {
      return (
        <div className="space-y-4" data-testid="zero-body">
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3">
            <p className="font-semibold text-red-900">ZERO verdict — final export blocked</p>
            <p className="mt-1 text-sm text-red-800">
              This job contains critical violations. The <strong>Final Approved Workbook</strong>{' '}
              cannot be produced. Only a <strong>Review Pack</strong> may be generated.
            </p>
          </div>
          <div className="rounded-md border border-red-200 bg-white px-4 py-3">
            <p className="text-sm font-medium text-red-900">
              Contract/Admin review acknowledgement required
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Confirm that Contract/Admin has reviewed the active triggers below before
              acknowledging.
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-800">
              <input
                ref={firstFieldRef}
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-gray-400"
                data-testid="zero-ack-checkbox"
                checked={contractAdminAcknowledged}
                onChange={(e) => setContractAdminAcknowledged(e.target.checked)}
                disabled={submitting}
              />
              <span>
                I confirm Contract/Admin has reviewed this ZERO verdict and approved the Review
                Pack.
              </span>
            </label>
          </div>
        </div>
      );
    }

    return null;
  }

  function renderFooter() {
    if (verdict === 'PASS') {
      return (
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            ref={closeButtonRef}
            type="button"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={submitting}
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            onClick={handleExport}
            disabled={submitting}
            data-testid="pass-confirm-button"
          >
            {submitting ? 'Exporting…' : 'Confirm & Export Final Workbook'}
          </button>
        </div>
      );
    }

    if (verdict === 'AMBER') {
      return (
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            ref={closeButtonRef}
            type="button"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={submitting}
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={submitting || !roleAuthorized}
            data-testid="amber-submit-button"
          >
            {submitting ? 'Submitting…' : 'Submit AMBER Acknowledgement'}
          </button>
        </div>
      );
    }

    // ZERO
    return (
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <button
          type="button"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleExport}
          disabled={submitting}
          data-testid="zero-review-pack-button"
        >
          {submitting ? 'Generating…' : 'Generate Review Pack (no Final Workbook)'}
        </button>
        <div className="flex items-center gap-2">
          <button
            ref={closeButtonRef}
            type="button"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={submitting}
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={submitting || !contractAdminAcknowledged || !roleAuthorized}
            data-testid="zero-submit-button"
          >
            {submitting ? 'Submitting…' : 'Acknowledge & Approve Review Pack'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      data-testid="approval-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-modal-title"
        aria-describedby="approval-modal-description"
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
        data-testid="approval-modal"
        data-verdict={verdict}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 id="approval-modal-title" className="text-lg font-semibold text-gray-900">
              Review Approval
            </h2>
            <p id="approval-modal-description" className="mt-1 text-sm text-gray-600">
              Job <code className="rounded bg-gray-100 px-1 py-0.5">{jobId}</code>
            </p>
            <span
              data-testid="verdict-badge"
              className={
                'mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ' +
                (verdict === 'PASS'
                  ? 'bg-green-100 text-green-800'
                  : verdict === 'AMBER'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-800')
              }
            >
              {verdict}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close approval modal"
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="close-button"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-4">
            {renderBody()}

            {verdict !== 'PASS' && (
              <div className="space-y-3 border-t border-gray-200 pt-4">
                <div>
                  <label
                    htmlFor="approver-identity"
                    className="block text-sm font-medium text-gray-900"
                  >
                    Approver identity
                  </label>
                  <input
                    id="approver-identity"
                    ref={verdict === 'ZERO' ? undefined : firstFieldRef}
                    type="text"
                    value={approverIdentity}
                    onChange={(e) => setApproverIdentity(e.target.value)}
                    disabled={submitting}
                    data-testid="approver-identity-input"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                    placeholder="e.g. finance.lee@samsungcnt"
                  />
                </div>
                <div>
                  <label htmlFor="comments" className="block text-sm font-medium text-gray-900">
                    Comments / acknowledgement reason
                  </label>
                  <textarea
                    id="comments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    disabled={submitting}
                    rows={3}
                    data-testid="comments-textarea"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                    placeholder="Provide reason for acknowledgement (required for AMBER_ACK)."
                  />
                </div>
              </div>
            )}

            {validationError && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                data-testid="validation-error"
              >
                {validationError}
              </div>
            )}
            {serverError && (
              <div
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
                data-testid="server-error"
              >
                {serverError}
              </div>
            )}
          </div>

          {renderFooter()}
        </form>
      </div>
    </div>
  );
}
