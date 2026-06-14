import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import {
  NotebookLmCallbackPayloadSchema,
  adaptNotebookLmToParserResult,
  compareParserAndNotebookLm,
  summarizeMismatchesForTrace
} from '@/lib/notebooklm';

export const runtime = 'nodejs';

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ code: 'BAD_REQUEST', message, details }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest('invalid json body');
  }

  const parsed = NotebookLmCallbackPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest('invalid NotebookLM callback payload', parsed.error.flatten());
  }

  const payload = parsed.data;
  const job = await STORE.getJob(payload.job_id);
  if (!job) {
    return NextResponse.json({ code: 'JOB_NOT_FOUND', message: 'unknown job_id' }, { status: 404 });
  }

  const receivedAt = payload.received_at ?? new Date().toISOString();
  const adapted = adaptNotebookLmToParserResult(payload.summary);
  const existingParserResult = await STORE.getNormalizedInvoice(payload.job_id);
  const mismatches = compareParserAndNotebookLm(existingParserResult, adapted);
  const highImpactMismatch = mismatches.length > 0;
  const summaryHash = createHash('sha256').update(JSON.stringify(payload.summary)).digest('hex');

  await STORE.appendTrace(payload.job_id, {
    step: 'NOTEBOOKLM',
    input_ref: payload.markdown_sha256 ?? payload.source_sha256 ?? payload.notebooklm_source_id,
    output_ref: highImpactMismatch ? 'NEEDS_REVIEW' : 'SUMMARY_INGESTED',
    source_hash: payload.markdown_sha256 ?? payload.source_sha256,
    calculation_hash: summaryHash,
    attributedTo: 'notebooklm:first-pass',
    notebooklm_source_id: payload.notebooklm_source_id,
    notebooklm_summary_received_at: receivedAt,
    notebooklm_confidence: payload.summary.confidence,
    notebooklm_flags: payload.summary.flags,
    dual_extraction_mismatches: summarizeMismatchesForTrace(mismatches)
  });

  if (!existingParserResult) {
    await STORE.setNormalizedInvoice(payload.job_id, adapted.normalized);
    const actionItems = [{
      action_id: `act_notebooklm_only_${payload.job_id}`,
      severity: 'AMBER' as const,
      line_id: '',
      issue_type: 'PARSER_FAILED_NOTEBOOKLM_SUCCEEDED',
      required_action: 'NotebookLM extracted a first-pass result, but the PDF parser result is missing. Manual review is required before audit approval.'
    }];
    await STORE.setResult(payload.job_id, {
      verdict: 'AMBER',
      line_results: [],
      action_items: actionItems
    });
    await STORE.updateJob(payload.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
    return NextResponse.json({
      job_id: payload.job_id,
      status: 'REVIEW_REQUIRED',
      verdict: 'AMBER',
      notebooklm_source_id: payload.notebooklm_source_id,
      notebooklm_confidence: payload.summary.confidence,
      notebooklm_flags: payload.summary.flags,
      dual_extraction_mismatches: [],
      parser_compatible: adapted
    }, { status: 202 });
  }

  if (highImpactMismatch) {
    const existing = await STORE.getResult(payload.job_id);
    const actionItems = [
      ...(existing?.action_items ?? []),
      {
        action_id: `act_notebooklm_mismatch_${payload.job_id}`,
        severity: 'AMBER' as const,
        line_id: '',
        issue_type: 'DUAL_EXTRACTION_MISMATCH',
        required_action: `NotebookLM disagrees with parser on high-impact fields: ${mismatches.map(m => m.field).join(', ')}`
      }
    ];
    await STORE.setResult(payload.job_id, {
      verdict: existing?.verdict === 'ZERO' ? 'ZERO' : 'AMBER',
      line_results: existing?.line_results ?? [],
      action_items: actionItems
    });
    await STORE.updateJob(payload.job_id, { status: 'REVIEW_REQUIRED', verdict: existing?.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
  }

  return NextResponse.json({
    job_id: payload.job_id,
    status: highImpactMismatch ? 'NEEDS_REVIEW' : 'SUMMARY_INGESTED',
    verdict: highImpactMismatch ? 'AMBER' : job.verdict,
    notebooklm_source_id: payload.notebooklm_source_id,
    notebooklm_confidence: payload.summary.confidence,
    notebooklm_flags: payload.summary.flags,
    dual_extraction_mismatches: mismatches.map(m => ({
      field: m.field,
      parser_value_hash: m.parser_value_hash,
      notebooklm_value_hash: m.notebooklm_value_hash,
      impact: m.impact
    })),
    parser_compatible: adapted
  }, { status: 202 });
}
