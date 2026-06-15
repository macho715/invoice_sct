import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { buildExportRequest } from '@/lib/workbook-builder';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORTS_MAP, isDevStub } from '@/lib/export-store';
import { evaluateApprovalGate, type ExportType } from '@/lib/approval-gate';

export const runtime = 'nodejs';

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  let body: { job_id?: string; generated_at?: string; kind?: 'FINAL_APPROVED' | 'REVIEW_PACK' };
  try {
    body = await req.json();
  } catch {
    return err('INVALID_STATE', 'invalid json body');
  }

  const jobId = body.job_id;
  const exportKind = (body.kind ?? 'FINAL_APPROVED') as ExportType;
  if (!jobId) {
    return err('INVALID_STATE', 'job_id required');
  }

  const job = await STORE.getJob(jobId);
  if (!job) {
    return err('JOB_NOT_FOUND', 'unknown job_id');
  }

  // Export gate — unified with the download route via evaluateApprovalGate.
  // Per Rule #1 (CLAUDE.md §0) the final Excel deliverable is always produced
  // for PASS/AMBER/ZERO; the workbook stamps the real verdict and labels
  // blocked/unverified items. Only FAILED (validation could not run) is
  // withheld. DLP masking is still enforced downstream at scan time.
  const approval = await STORE.getApprovalRecord(jobId);
  const gate = evaluateApprovalGate({
    verdict: job.verdict ?? 'FAILED',
    approval: approval ?? null,
    exportType: exportKind,
    varianceAed: 0
  });
  if (!gate.allowed) {
    return err(gate.error_code as ErrorCode, gate.reason);
  }

  // Replay check
  const replayKey = `${jobId}|${exportKind}|${job.parser_version}|${job.rule_version}`;
  const existing = EXPORTS_MAP.get(replayKey);
  if (existing) {
    return NextResponse.json({
      ...(existing.result as Record<string, unknown>),
      info: 'EXPORT_REPLAY_DETECTED'
    });
  }

  const useDevExportStub = isDevStub()
    && !process.env.PARSER_WORKER_URL && !process.env.WORKER_URL
    && typeof (globalThis.fetch as unknown as { mock?: unknown })?.mock === 'undefined';
  let exportResult;

  if (useDevExportStub) {
    exportResult = {
      job_id: jobId,
      kind: exportKind,
      access: 'private',
      manifest: {
        sha256: '0'.repeat(64),
        size_bytes: 0,
        sheets: [{ sheet_name: '00_Decision', row_count: 1 }],
        generated_at: body.generated_at ?? new Date().toISOString(),
      },
      file_content_base64: Buffer.from('dev-export-stub').toString('base64'),
    };
  } else {
    let exportReq;
    try {
      exportReq = await buildExportRequest(jobId, body.generated_at);
    } catch (e) {
      return err('EXPORT_FAILED', (e as Error).message);
    }

    const parserUrl = process.env.PARSER_WORKER_URL ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8000';
    let response;
    try {
      response = await fetch(`${parserUrl}/v1/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportReq)
      });
    } catch (e) {
      return err('EXPORT_FAILED', `Failed to connect to exporter worker: ${(e as Error).message}`);
    }

    if (!response.ok) {
      const txt = await response.text();
      return err('EXPORT_FAILED', `Exporter worker returned error: ${txt}`);
    }

    exportResult = await response.json();
  }

  const buffer = Buffer.from(exportResult.file_content_base64, 'base64');
  const filename = `exports/${jobId}/audit-pack-${exportResult.manifest.sha256.slice(0, 8)}.xlsx`;
  let signedUrl = '';

  if (isDevStub()) {
    const devBlobDir = join(process.cwd(), '.dev-blob');
    const target = join(devBlobDir, filename);
    mkdirSync(join(devBlobDir, `exports/${jobId}`), { recursive: true });
    writeFileSync(target, buffer);
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
    signedUrl = `${base}/api/dev/blob/${encodeURIComponent(filename)}`;
  } else {
    const { put } = await import('@vercel/blob');
    const res = await put(filename, buffer, {
      access: 'private' as any,
      addRandomSuffix: true,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    // put() already returns the signed download URL; the prior getDownloadUrl(pathname)
    // call threw "TypeError: Invalid URL" on the private store and 500'd every prod export.
    signedUrl = res.downloadUrl;
  }

  await STORE.appendTrace(jobId, {
    step: 'EXPORT',
    input_ref: jobId,
    output_ref: filename,
    source_hash: undefined,
    calculation_hash: exportResult.manifest.sha256,
    attributedTo: 'excel-exporter'
  });

  const record = { result: exportResult, url: signedUrl };
  EXPORTS_MAP.set(replayKey, record);
  // Also index by jobId for simple lookup
  EXPORTS_MAP.set(jobId, record);

  return NextResponse.json({ ...exportResult, signed_url: signedUrl, access: 'private', kind: exportKind });
}
