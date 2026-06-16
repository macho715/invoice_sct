import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { httpForError, type ErrorCode } from '@/lib/error-codes';
import { requireJobToken } from '@/lib/job-token';
import { VALIDATOR_VERSION, type ValidationIssue } from '@/lib/invoice/schema';

/**
 * GET /api/invoices/[invoiceId] — PR 3.3
 *
 * Invoice status + audit log query. Rule #0: always respond (no 5xx).
 * If the job store cannot find the invoice, return 404 with a structured
 * error — never crash the request.
 *
 * @see PLAN_20260616_160103.md PR 3.3
 */

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, message, ...extra }, { status: httpForError(code) });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  // Next.js 15: params is a Promise<>
  const resolved = await Promise.resolve(params);
  const invoiceId = resolved.invoiceId;

  if (!invoiceId || typeof invoiceId !== 'string') {
    return err('INVALID_REQUEST', 'invoiceId is required');
  }

  const job = await STORE.getJob(invoiceId);
  if (!job) {
    return err('JOB_NOT_FOUND', `invoice ${invoiceId} not found`, { invoice_id: invoiceId });
  }

  // Token check (if Authorization/job_token present, enforce; else allow read for dev)
  const tokenError = requireJobToken(req, job, null);
  if (tokenError) return tokenError;

  // Pull source files + last audit log entry in parallel.
  const [sourceFiles, lastAudit] = await Promise.all([
    STORE.listSourceFiles(job.job_id).catch(() => []),
    STORE.getInvoiceAuditLog(invoiceId, VALIDATOR_VERSION, null).catch(() => null),
  ]);

  return NextResponse.json({
    invoice_id: job.job_id,
    job_id: job.job_id,
    status: job.status,
    verdict: job.verdict,
    workflow_type: job.workflow_type,
    created_by: job.created_by,
    created_at: job.created_at,
    updated_at: job.updated_at,
    rule_version: job.rule_version,
    parser_version: job.parser_version,
    source_files: sourceFiles.map((f) => ({
      file_id: f.file_id,
      original_filename: f.original_filename,
      file_type: f.file_type,
      size_bytes: f.size_bytes,
      sha256: f.sha256,
      parser_status: f.parser_status,
      uploaded_at: f.uploaded_at,
    })),
    last_audit_log: lastAudit
      ? {
          validator_version: lastAudit.validator_version,
          result_status: lastAudit.result_status,
          rate_manifest_version: lastAudit.rate_manifest_version,
          issues_count: Array.isArray(lastAudit.issues) ? lastAudit.issues.length : 0,
          validation_finished_at: lastAudit.validation_finished_at,
        }
      : null,
  });
}
