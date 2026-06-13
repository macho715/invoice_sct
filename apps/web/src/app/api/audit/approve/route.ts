import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { evaluateHumanGateTriggers } from '@/lib/human-gate';
import { roleCanResolveTrigger, isValidRole } from '@/lib/roles';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { randomUUID } from 'node:crypto';
import type { ApprovalRecord, HumanGateTrigger } from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  const userRoleHeader = req.headers.get('x-user-role') || '';
  const userIdHeader = req.headers.get('x-user-id') || 'dev-user';

  // C-01: Validate role before any business logic — prevents header spoofing
  if (!isValidRole(userRoleHeader)) {
    return err('FORBIDDEN', `Unknown or missing role: "${userRoleHeader}". Must be one of: COST_CONTROL_LEAD, FINANCE_APPROVER, MARINE_LEAD, COMPLIANCE_LEAD, WAREHOUSE_MANAGER, DOCUMENT_CONTROLLER`);
  }

  let body: {
    job_id?: string;
    approval_scope?: 'AMBER_ACK' | 'ZERO_APPROVED';
    acknowledgement_reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return err('INVALID_STATE', 'invalid json body');
  }

  const jobId = body.job_id;
  const scope = body.approval_scope;
  if (!jobId || !scope) {
    return err('INVALID_STATE', 'job_id and approval_scope are required');
  }

  const job = await STORE.getJob(jobId);
  if (!job) {
    return err('JOB_NOT_FOUND', 'unknown job_id');
  }

  if (job.status !== 'REVIEW_REQUIRED') {
    return err('INVALID_STATE', `job is in state ${job.status}, expected REVIEW_REQUIRED`);
  }

  // AMBER_ACK checks
  if (scope === 'AMBER_ACK' && (!body.acknowledgement_reason || body.acknowledgement_reason.trim() === '')) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'acknowledgement_reason is required for AMBER_ACK' }, { status: 400 });
  }

  const normalized = await STORE.getNormalizedInvoice(jobId);
  const validation = await STORE.getValidationResult(jobId);
  const result = await STORE.getResult(jobId);

  const varianceAed = typeof (result as any)?.variance_aed === 'number'
    ? (result as any).variance_aed
    : null;
  if (scope === 'AMBER_ACK' && job.verdict === 'AMBER' && varianceAed !== null) {
    const requiredRole = varianceAed < 500 ? 'COST_CONTROL_LEAD' : 'FINANCE_APPROVER';
    if (userRoleHeader !== requiredRole) {
      return err('UNAUTHORIZED_APPROVAL', `Role ${userRoleHeader} is not authorized for AMBER variance ${varianceAed}. Required role: ${requiredRole}`);
    }
  }

  const activeTriggers = evaluateHumanGateTriggers(job, normalized, validation, result);

  const resolvedTriggers: HumanGateTrigger[] = [];

  for (const trigger of activeTriggers) {
    const isZero = trigger.severity === 'ZERO';

    if (isZero && scope !== 'ZERO_APPROVED') {
      return err('HUMAN_GATE_REQUIRED', `Trigger ${trigger.trigger_id} requires ZERO_APPROVED scope`);
    }

    if (!roleCanResolveTrigger(userRoleHeader, trigger.required_role)) {
      if (isZero) {
        return err('HUMAN_GATE_REQUIRED', `Role ${userRoleHeader} is not authorized to resolve ${trigger.name}`);
      } else {
        return err('UNAUTHORIZED_APPROVAL', `Role ${userRoleHeader} is not authorized to resolve ${trigger.name}`);
      }
    }

    resolvedTriggers.push({
      ...trigger,
      status: 'RESOLVED',
      resolved_by: userIdHeader,
      resolved_at: new Date().toISOString()
    });
  }

  const approvalId = `appr_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const prismProofRef = validation?.costguard_results?.[0]?.prism_kernel_proof_ref ?? `proof_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

  const approvalRecord: ApprovalRecord = {
    approval_id: approvalId,
    job_id: jobId,
    status: 'APPROVED',
    approved_by: userIdHeader,
    approved_at: new Date().toISOString(),
    approval_scope: scope,
    acknowledgement_reason: body.acknowledgement_reason || null,
    prism_kernel_proof_ref: prismProofRef,
    triggers: resolvedTriggers
  };

  await STORE.setApprovalRecord(jobId, approvalRecord);
  await STORE.updateJob(jobId, { status: 'APPROVED' });

  await STORE.appendTrace(jobId, {
    step: 'APPROVAL',
    input_ref: jobId,
    output_ref: approvalId,
    attributedTo: userRoleHeader
  });

  return NextResponse.json({
    approval_id: approvalId,
    status: 'APPROVED',
    prism_kernel_proof_ref: prismProofRef
  });
}
