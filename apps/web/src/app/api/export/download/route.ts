import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORTS_MAP, isDevStub } from '@/lib/export-store';
import { evaluateApprovalGate, type ExportType } from '@/lib/approval-gate';
import { buildExportRequest } from '@/lib/workbook-builder';
import type { ExportRequest } from '@/lib/types';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return err('INVALID_STATE', 'job_id required');

  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');

  const exportType = (url.searchParams.get('export_type') || 'FINAL_APPROVED') as ExportType;

  if (exportType !== 'FINAL_APPROVED' && exportType !== 'REVIEW_PACK') {
    return err('INVALID_STATE', 'export_type must be FINAL_APPROVED or REVIEW_PACK');
  }

  const approval = await STORE.getApprovalRecord(jobId);
  const verdict = job.verdict ?? 'FAILED';

  const gate = evaluateApprovalGate({
    verdict,
    approval: approval ?? null,
    exportType,
    varianceAed: 0,
  });

  if (!gate.allowed) {
    return err(gate.error_code as ErrorCode, gate.reason);
  }

  // Build the export request once for the cross-instance regeneration fallback
  // below. EXPORTS_MAP is in-process only and is NOT shared across serverless
  // instances, so on a cache miss we rebuild from audit data instead.
  // NOTE: download-route DLP scanning was intentionally removed (per operator
  // decision 2026-06-14). The final Excel is delivered without a workbook-level
  // DLP re-scan; see CLAUDE.md "DLP" notes.
  let exportReq: ExportRequest | null = null;
  try {
    exportReq = await buildExportRequest(jobId, undefined);
  } catch {
    // No audit data available (e.g. dev stub); the regeneration fallback handles it.
  }

  const record = EXPORTS_MAP.get(jobId);
  let buffer: Buffer;

  if (isDevStub()) {
    // Local dev: bytes live on disk, written by the export step in this process.
    if (!record) return err('INVALID_STATE', 'Job has not been exported yet');
    const filename = `exports/${jobId}/audit-pack-${(record.result as any).manifest.sha256.slice(0, 8)}.xlsx`;
    const target = join(process.cwd(), '.dev-blob', filename);
    if (!existsSync(target)) {
      return err('INVALID_STATE', 'Exported file not found on disk');
    }
    buffer = readFileSync(target);
  } else if (record) {
    // Fast path: same instance that exported — serve the uploaded blob.
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) throw new Error('BLOB_READ_WRITE_TOKEN not configured');
      const res = await fetch(record.url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch from blob: ${res.statusText}`);
      }
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return err('EXPORT_FAILED', `Failed to download file from storage: ${(e as Error).message}`);
    }
  } else {
    // Rule #1 (CLAUDE.md §0): the final Excel must always be downloadable once the
    // job has audit data. On a cross-instance cache miss, regenerate the workbook
    // deterministically from the exporter worker instead of returning "not exported".
    if (!exportReq) {
      return err('EXPORT_FAILED', 'No audit data available to build the export');
    }
    try {
      const parserUrl = process.env.PARSER_WORKER_URL ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8000';
      const parserToken = process.env.PARSER_WORKER_TOKEN ?? '';
      const resp = await fetch(`${parserUrl}/v1/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(parserToken ? { Authorization: `Bearer ${parserToken}` } : {}),
        },
        body: JSON.stringify(exportReq),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return err('EXPORT_FAILED', `Exporter worker returned error: ${txt}`);
      }
      const exportResult = await resp.json();
      buffer = Buffer.from(exportResult.file_content_base64, 'base64');
    } catch (e) {
      return err('EXPORT_FAILED', `Failed to regenerate export: ${(e as Error).message}`);
    }
  }

  const filenameHeader = `audit-pack-${jobId}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameHeader}"`
    }
  });
}
