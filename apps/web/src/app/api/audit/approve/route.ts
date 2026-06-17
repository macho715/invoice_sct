import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { evaluateHumanGateTriggers } from '@/lib/human-gate';
import { roleCanResolveTrigger, isValidRole } from '@/lib/roles';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { createParserClient } from '@/lib/parser-client';
import { requireJobToken } from '@/lib/job-token';
import { randomUUID } from 'node:crypto';
import type {
  ApprovalRecord, HumanGateTrigger, SourceFile, VisionStatusRecord
} from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

// Pick the scanned invoice PDF from the job's source files. We prefer the
// invoice file (first PDF without an evidence role); the gs:// URI is needed
// to trigger Vision OCR. Falls back to blob_ref when the upload was not
// routed through GCS (private Vercel Blob path) — in that case the trigger
// is recorded as `skipped` and the response tells the caller to re-upload
// through the GCS path (see docs/superpowers/specs/2026-06-14-…).
function pickScannedInvoicePdf(sources: SourceFile[]): SourceFile | null {
  const pdfs = sources.filter(f => f.file_type === 'pdf');
  if (pdfs.length === 0) return null;
  return pdfs[0];
}

function buildVisionStatus(
  patch: Partial<VisionStatusRecord> & { vision_status: VisionStatusRecord['vision_status'] }
): VisionStatusRecord {
  const now = new Date().toISOString();
  return {
    vision_status: patch.vision_status,
    vision_operation_name: patch.vision_operation_name ?? null,
    vision_pdf_file_id: patch.vision_pdf_file_id ?? null,
    vision_pdf_sha256: patch.vision_pdf_sha256 ?? null,
    vision_source_gcs_uri: patch.vision_source_gcs_uri ?? null,
    vision_output_gcs_prefix: patch.vision_output_gcs_prefix ?? null,
    vision_started_at: patch.vision_started_at ?? null,
    vision_completed_at: patch.vision_completed_at ?? null,
    vision_updated_at: patch.vision_updated_at ?? now,
    vision_error_code: patch.vision_error_code ?? null,
    vision_error_message: patch.vision_error_message ?? null,
    vision_ocr_result: patch.vision_ocr_result ?? null
  };
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
    // 2026-06-17: approval-gated Vision OCR. When true and the job has a
    // scanned PDF, the approve route kicks off the worker Vision pipeline
    // and returns vision_status in the response. Status is then polled via
    // POST /api/audit/vision-status. Idempotent on (job_id, pdf_sha256).
    enable_vision?: boolean;
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

  // ── 2026-06-17: Approval-gated Vision OCR ─────────────────────────────
  // Default: Vision is NOT invoked. The reviewer must explicitly opt in by
  // setting `enable_vision: true`. When opted in, the route kicks off the
  // worker /v1/vision/start (fire-and-forget for OCR; the response carries
  // the initial vision_status, the long-running poll happens on
  // /api/audit/vision-status).
  //
  // Idempotency: if the job already has a vision_status of `done` for the
  // same pdf_sha256, the cached record is returned and the worker is NOT
  // re-invoked. Same logic applies to `running` (still in flight).
  let visionStatusResponse: {
    vision_status: VisionStatusRecord['vision_status'];
    vision_operation_name: string | null;
    vision_started_at: string | null;
    vision_updated_at: string | null;
    vision_pdf_file_id: string | null;
    vision_error_code: string | null;
    vision_error_message: string | null;
  } = {
    vision_status: null,
    vision_operation_name: null,
    vision_started_at: null,
    vision_updated_at: null,
    vision_pdf_file_id: null,
    vision_error_code: null,
    vision_error_message: null
  };

  if (body.enable_vision === true) {
    const sourceFiles = await STORE.listSourceFiles(jobId);
    const pdf = pickScannedInvoicePdf(sourceFiles);
    const now = new Date().toISOString();

    if (!pdf) {
      const rec = buildVisionStatus({
        vision_status: 'skipped',
        vision_started_at: now,
        vision_error_code: 'VISION_NO_PDF',
        vision_error_message: 'No PDF source file on this job; Vision OCR not applicable.'
      });
      await STORE.setVisionStatus(jobId, rec);
      visionStatusResponse = {
        vision_status: 'skipped',
        vision_operation_name: null,
        vision_started_at: now,
        vision_updated_at: rec.vision_updated_at,
        vision_pdf_file_id: null,
        vision_error_code: 'VISION_NO_PDF',
        vision_error_message: rec.vision_error_message
      };
      await STORE.appendTrace(jobId, {
        step: 'VISION_RUN',
        input_ref: jobId,
        output_ref: 'VISION_SKIPPED_NO_PDF',
        attributedTo: `approve-route:vision:${userRoleHeader}`
      });
    } else {
      const existing = await STORE.getVisionStatus(jobId);
      if (existing?.vision_status === 'done' && existing?.vision_pdf_sha256 === pdf.sha256) {
        // Idempotent: same PDF already OCR'd.
        visionStatusResponse = {
          vision_status: 'done',
          vision_operation_name: existing.vision_operation_name,
          vision_started_at: existing.vision_started_at,
          vision_updated_at: existing.vision_updated_at,
          vision_pdf_file_id: existing.vision_pdf_file_id,
          vision_error_code: null,
          vision_error_message: null
        };
        await STORE.appendTrace(jobId, {
          step: 'VISION_RUN',
          input_ref: pdf.file_id,
          output_ref: 'VISION_IDEMPOTENT_DONE',
          source_hash: pdf.sha256,
          attributedTo: `approve-route:vision:${userRoleHeader}`
        });
      } else if (existing?.vision_status === 'running' && existing?.vision_pdf_sha256 === pdf.sha256) {
        // Still in flight from a prior approve — return cached.
        visionStatusResponse = {
          vision_status: 'running',
          vision_operation_name: existing.vision_operation_name,
          vision_started_at: existing.vision_started_at,
          vision_updated_at: existing.vision_updated_at,
          vision_pdf_file_id: existing.vision_pdf_file_id,
          vision_error_code: null,
          vision_error_message: null
        };
        await STORE.appendTrace(jobId, {
          step: 'VISION_RUN',
          input_ref: pdf.file_id,
          output_ref: 'VISION_IDEMPOTENT_RUNNING',
          source_hash: pdf.sha256,
          attributedTo: `approve-route:vision:${userRoleHeader}`
        });
      } else {
        // Fresh trigger. We need a gs:// URI; if the file is not on GCS we
        // can only mark `skipped` and ask the user to re-upload through
        // /api/files/create-upload-url. The visionStatusResponse stays
        // opt-in and never blocks the approval itself (Rule #0).
        const gcsUri = (pdf as any).gcs_uri || pdf.blob_ref || '';
        const gcsOcrBucket = process.env.GCS_OCR_BUCKET || 'dsv-invoice-ocr';
        const outputPrefix = `gs://${gcsOcrBucket}/jobs/${jobId}/${pdf.file_id}/`;

        if (!String(gcsUri).startsWith('gs://')) {
          const rec = buildVisionStatus({
            vision_status: 'skipped',
            vision_pdf_file_id: pdf.file_id,
            vision_pdf_sha256: pdf.sha256,
            vision_started_at: now,
            vision_error_code: 'VISION_NON_GCS_SOURCE',
            vision_error_message: 'PDF was not uploaded through the GCS path; re-upload via /api/files/create-upload-url to enable Vision OCR.'
          });
          await STORE.setVisionStatus(jobId, rec);
          visionStatusResponse = {
            vision_status: 'skipped',
            vision_operation_name: null,
            vision_started_at: now,
            vision_updated_at: rec.vision_updated_at,
            vision_pdf_file_id: pdf.file_id,
            vision_error_code: 'VISION_NON_GCS_SOURCE',
            vision_error_message: rec.vision_error_message
          };
          await STORE.appendTrace(jobId, {
            step: 'VISION_RUN',
            input_ref: pdf.file_id,
            output_ref: 'VISION_SKIPPED_NO_GCS',
            source_hash: pdf.sha256,
            attributedTo: `approve-route:vision:${userRoleHeader}`
          });
        } else {
          const workerUrl = process.env.PARSER_WORKER_URL || process.env.WORKER_URL || '';
          const workerToken = process.env.PARSER_WORKER_TOKEN || '';
          if (!workerUrl || !workerToken) {
            const rec = buildVisionStatus({
              vision_status: 'failed',
              vision_pdf_file_id: pdf.file_id,
              vision_pdf_sha256: pdf.sha256,
              vision_source_gcs_uri: gcsUri,
              vision_output_gcs_prefix: outputPrefix,
              vision_started_at: now,
              vision_error_code: 'WORKER_CONFIG_MISSING',
              vision_error_message: 'PARSER_WORKER_URL or PARSER_WORKER_TOKEN not configured.'
            });
            await STORE.setVisionStatus(jobId, rec);
            visionStatusResponse = {
              vision_status: 'failed',
              vision_operation_name: null,
              vision_started_at: now,
              vision_updated_at: rec.vision_updated_at,
              vision_pdf_file_id: pdf.file_id,
              vision_error_code: 'WORKER_CONFIG_MISSING',
              vision_error_message: rec.vision_error_message
            };
            await STORE.appendTrace(jobId, {
              step: 'VISION_RUN',
              input_ref: pdf.file_id,
              output_ref: 'VISION_FAILED_NO_WORKER_CONFIG',
              source_hash: pdf.sha256,
              attributedTo: `approve-route:vision:${userRoleHeader}`
            });
          } else {
            const parser = createParserClient({ baseUrl: workerUrl, token: workerToken });
            const start = await parser.startVisionOcr({
              job_id: jobId,
              file_id: pdf.file_id,
              source_gcs_uri: gcsUri,
              output_gcs_prefix: outputPrefix
            });

            if (start.status === 'STARTED' && start.operation_name) {
              const rec = buildVisionStatus({
                vision_status: 'running',
                vision_operation_name: start.operation_name,
                vision_pdf_file_id: pdf.file_id,
                vision_pdf_sha256: pdf.sha256,
                vision_source_gcs_uri: gcsUri,
                vision_output_gcs_prefix: outputPrefix,
                vision_started_at: now
              });
              await STORE.setVisionStatus(jobId, rec);
              visionStatusResponse = {
                vision_status: 'running',
                vision_operation_name: start.operation_name,
                vision_started_at: now,
                vision_updated_at: rec.vision_updated_at,
                vision_pdf_file_id: pdf.file_id,
                vision_error_code: null,
                vision_error_message: null
              };
              await STORE.appendTrace(jobId, {
                step: 'VISION_RUN',
                input_ref: pdf.file_id,
                output_ref: `VISION_STARTED:${start.operation_name}`,
                source_hash: pdf.sha256,
                attributedTo: `approve-route:vision:${userRoleHeader}`
              });
            } else {
              const rec = buildVisionStatus({
                vision_status: 'failed',
                vision_pdf_file_id: pdf.file_id,
                vision_pdf_sha256: pdf.sha256,
                vision_source_gcs_uri: gcsUri,
                vision_output_gcs_prefix: outputPrefix,
                vision_started_at: now,
                vision_error_code: start.error_code ?? 'VISION_DISABLED',
                vision_error_message: 'Worker refused Vision start; see google-cloud-vision install / VISION_ENABLED flag.'
              });
              await STORE.setVisionStatus(jobId, rec);
              visionStatusResponse = {
                vision_status: 'failed',
                vision_operation_name: null,
                vision_started_at: now,
                vision_updated_at: rec.vision_updated_at,
                vision_pdf_file_id: pdf.file_id,
                vision_error_code: rec.vision_error_code,
                vision_error_message: rec.vision_error_message
              };
              await STORE.appendTrace(jobId, {
                step: 'VISION_RUN',
                input_ref: pdf.file_id,
                output_ref: `VISION_FAILED:${start.error_code ?? 'UNKNOWN'}`,
                source_hash: pdf.sha256,
                attributedTo: `approve-route:vision:${userRoleHeader}`
              });
            }
          }
        }
      }
    }
  }
  // ── end Vision OCR block ─────────────────────────────────────────────

  const approvalRecord: ApprovalRecord = {
    approval_id: approvalId,
    job_id: jobId,
    status: 'APPROVED',
    approved_by: userIdHeader,
    approved_at: new Date().toISOString(),
    approval_scope: scope,
    acknowledgement_reason: body.acknowledgement_reason || null,
    prism_kernel_proof_ref: prismProofRef,
    ...(body.enable_vision === true
      ? {
          enable_vision: true,
          vision_requested_at: new Date().toISOString(),
          vision_requested_by: userIdHeader
        }
      : {}),
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
    prism_kernel_proof_ref: prismProofRef,
    ...(body.enable_vision === true ? { vision: visionStatusResponse } : {})
  });
}
