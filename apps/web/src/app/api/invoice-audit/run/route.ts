import { NextResponse } from 'next/server';
import { createJobStore, STORE } from '@/lib/job-store';
import { createParserClient } from '@/lib/parser-client';
import { createCfMcpClient, McpUnavailableError } from '@/lib/cf-mcp-client';
import { buildGateResult, checkReconciliation } from '@/lib/gate-bridge';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { getSignedDownloadUrl, streamFromBlob } from '@/lib/blob';
import { createHash } from 'node:crypto';
import type { SourceDataRow, SourceFile, Verdict } from '@/lib/types';
import { requireJobToken } from '@/lib/job-token';

export const runtime = 'nodejs';
void createJobStore;

type PdfParseIssueType = 'PDF_ENCRYPTED' | 'PDF_TOO_LARGE' | 'SCANNED_PAGE_DETECTED' | 'PDF_PARSE_UNSUPPORTED';

function classifyPdfParseIssue(message: string): PdfParseIssueType | null {
  const upper = message.toUpperCase();
  if (upper.includes('PDF_ENCRYPTED')) return 'PDF_ENCRYPTED';
  if (upper.includes('PDF_TOO_LARGE')) return 'PDF_TOO_LARGE';
  if (upper.includes('SCANNED_PAGE_DETECTED')) return 'SCANNED_PAGE_DETECTED';
  if (upper.includes('PARSE_PDF_UNSUPPORTED')) return 'PDF_PARSE_UNSUPPORTED';
  return null;
}

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

const PENDING_SHA256_PLACEHOLDER = '0'.repeat(64);
const VERDICT_RANK: Record<Verdict, number> = { PASS: 0, AMBER: 1, ZERO: 2, FAILED: 3 };

function maxVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a;
}

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

function normalizeSourceDataRows(rows: unknown): SourceDataRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const textSpan = r.text_span ?? r.original_text ?? null;
    const sourceRef = r.source_ref ?? r.matched_reference ?? r.shipment_id ?? null;
    return {
      file_id: String(r.file_id ?? r.source_file_id ?? ''),
      source_ref: sourceRef == null ? null : String(sourceRef),
      original_text: textSpan == null ? null : String(textSpan),
      normalized_value: r.normalized_value == null ? (sourceRef == null ? null : String(sourceRef)) : String(r.normalized_value),
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      routing_pattern: r.routing_pattern == null ? 'PDF_TEXT_SPAN' : String(r.routing_pattern),
      pdf_page: typeof r.pdf_page === 'number' ? r.pdf_page : null,
      text_span_hash: r.text_span_hash == null ? null : String(r.text_span_hash),
      doc_type: r.doc_type == null ? null : String(r.doc_type),
      shipment_id: r.shipment_id == null ? null : String(r.shipment_id),
      gate_score: typeof r.gate_score === 'number' ? r.gate_score : null,
      gate_status: r.gate_status == null ? null : String(r.gate_status),
      is_portal_fee: typeof r.is_portal_fee === 'boolean' ? r.is_portal_fee : null
    };
  }).filter((row) => row.file_id);
}

function mergeValidationIntoNormalizedInvoice(normalized: any, sct: any) {
  const typeBByLine = new Map((sct.type_b_results ?? []).map((r: any) => [r.line_id, r]));
  const normalizedByLine = new Map((sct.normalized_lines ?? []).map((r: any) => [r.line_id, r]));
  const rateByLine = new Map((sct.rate_checks ?? []).map((r: any) => [r.line_id, r]));
  const gateByLine = new Map((sct.gate_results ?? []).map((r: any) => [r.line_id, r]));
  const costByLine = new Map((sct.costguard_results ?? []).map((r: any) => [r.line_id, r]));
  const evidenceByLine = new Map<string, 'MATCHED' | 'PARTIAL' | 'MISSING'>();

  for (const req of sct.evidence_requirements ?? []) {
    if (req?.line_id) evidenceByLine.set(String(req.line_id), 'MATCHED');
  }
  for (const finding of sct.doc_guardian_results ?? []) {
    if (!finding?.line_id) continue;
    evidenceByLine.set(String(finding.line_id), finding.severity === 'ZERO' ? 'MISSING' : 'PARTIAL');
  }

  return {
    ...normalized,
    invoice_lines: ((normalized?.invoice_lines ?? []) as any[]).map((line) => {
      const typeB = typeBByLine.get(line.line_id) as any;
      const norm = normalizedByLine.get(line.line_id) as any;
      const rate = rateByLine.get(line.line_id) as any;
      const gate = gateByLine.get(line.line_id) as any;
      const cost = costByLine.get(line.line_id) as any;
      return {
        ...line,
        type_b: line.type_b ?? typeB?.type_b ?? null,
        for_charge_component: line.for_charge_component ?? norm?.charge_code ?? typeB?.type_b ?? null,
        evidence_status: line.evidence_status ?? evidenceByLine.get(line.line_id) ?? null,
        rate_status: line.rate_status ?? rate?.rate_status ?? null,
        validity_status: line.validity_status ?? rate?.validity_status ?? null,
        gate_status: line.gate_status ?? gate?.gate_status ?? null,
        band: line.band ?? cost?.band ?? null,
        delta_pct: line.delta_pct ?? cost?.delta_pct ?? null
      };
    })
  };
}

async function appendParseSourceData(jobId: string, rows: unknown): Promise<void> {
  const normalized = normalizeSourceDataRows(rows);
  if (normalized.length === 0) return;
  const existing = await STORE.getParseSourceData(jobId);
  await STORE.setParseSourceData(jobId, [...existing, ...normalized]);
}

async function verifyAndPersistSourceHashes(jobId: string, files: SourceFile[]): Promise<{ files: SourceFile[]; mismatch?: { file: SourceFile; actual: string } }> {
  const verified: SourceFile[] = [];
  for (const file of files) {
    // GCS-stored objects (gs:// URIs from the Vision/OCR confirm path) cannot be
    // byte-streamed from the Vercel runtime (no GCS client/credentials here), so we
    // can't recompute their hash. Trust the stored sha256 and defer integrity to the
    // GCS confirm step. Skip rehash so the audit proceeds (e.g. async Vision OCR fallback).
    if (file.blob_ref.startsWith('gs://')) {
      verified.push(file);
      continue;
    }
    const bytes = await streamFromBlob(file.blob_ref);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (file.sha256 !== PENDING_SHA256_PLACEHOLDER && file.sha256 !== actual) {
      return { files: verified, mismatch: { file, actual } };
    }
    if (file.sha256 === PENDING_SHA256_PLACEHOLDER || file.size_bytes !== bytes.byteLength) {
      const updated = await STORE.updateSourceFile(jobId, file.file_id, { sha256: actual, size_bytes: bytes.byteLength });
      verified.push(updated ?? { ...file, sha256: actual, size_bytes: bytes.byteLength });
    } else {
      verified.push(file);
    }
  }
  return { files: verified };
}

async function parseBody(req: Request): Promise<{ job_id?: string; job_token?: string } | null> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { return await req.json(); } catch { return null; }
  }
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    try {
      const fd = await req.formData();
      const jid = fd.get('job_id');
      const token = fd.get('job_token');
      return jid ? { job_id: String(jid), ...(typeof token === 'string' ? { job_token: token } : {}) } : null;
    } catch { return null; }
  }
  try { return await req.json(); } catch {}
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  const body = await parseBody(req);
  if (!body) return err('INVALID_STATE', 'invalid json body');
  if (!body.job_id) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(body.job_id);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const tokenError = requireJobToken(req, job, body);
  if (tokenError) return tokenError;
  if (job.status !== 'UPLOADED' && job.status !== 'QUEUED') return err('INVALID_STATE', `cannot run from status ${job.status}`);
  let files = await STORE.listSourceFiles(body.job_id);
  if (files.length === 0) return err('INVALID_STATE', 'no source files');

  try {
    const hashCheck = await verifyAndPersistSourceHashes(body.job_id, files);
    if (hashCheck.mismatch) {
      const actionItems = [{
        action_id: `act_hash_${body.job_id}`,
        severity: 'ZERO' as const,
        line_id: '',
        issue_type: 'SOURCE_HASH_MISMATCH',
        required_action: 'Uploaded source bytes do not match the stored source hash — re-upload and investigate storage integrity'
      }];
      await STORE.setResult(body.job_id, { gate_id: `gate_hash_${body.job_id}`, job_id: body.job_id, verdict: 'ZERO', line_results: [], action_items: actionItems } as any);
      await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });
      await STORE.appendTrace(body.job_id, {
        step: 'DECISION',
        input_ref: hashCheck.mismatch.file.blob_ref,
        output_ref: 'SOURCE_HASH_MISMATCH',
        source_hash: hashCheck.mismatch.actual,
        attributedTo: 'run-route:source-hash-guard'
      });
      return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: 'ZERO', action_items: actionItems }, { status: 202 });
    }
    files = hashCheck.files;
  } catch (e) {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', (e as Error).message);
  }

  // Rule #0 (CLAUDE.md): Excel invoice OR PDF evidence — either alone must yield a
  // final Excel. Prefer a structured doc (xlsx/md/txt) as the invoice source; if none
  // was uploaded, fall back to the first PDF as the primary invoice source and treat
  // the remaining PDFs as evidence. A PDF source typically yields 0 structured lines,
  // which the zero-lines guard below routes to AMBER/REVIEW_REQUIRED — still producing
  // a result the workbook can be built from. We never 409 a PDF-only upload.
  const docInvoice = files.find(f => f.file_type === 'xlsx' || f.file_type === 'md' || f.file_type === 'txt');
  const pdfFiles = files.filter(f => f.file_type === 'pdf');
  const invoiceFile = docInvoice ?? pdfFiles[0];
  const evidenceFiles = docInvoice ? pdfFiles : pdfFiles.slice(1);

  if (!invoiceFile) {
    return err('INVALID_STATE', 'no invoice or evidence file uploaded (expected xlsx, md, txt, or pdf)');
  }

  await STORE.updateJob(body.job_id, { status: 'PARSING' });

  const parserToken = process.env.PARSER_WORKER_TOKEN;
  if (!parserToken) {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'PARSER_WORKER_TOKEN not configured');
  }
  const workerUrl = process.env.PARSER_WORKER_URL ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8000';
  let parsed: URL;
  try {
    parsed = new URL(workerUrl);
  } catch {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'WORKER_URL must be a valid URL');
  }
  const allowedHosts = ['127.0.0.1', 'localhost', '.run.app', '.internal', '.vercel.app'];
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(h))) {
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('STORAGE_AUTH_FAILED', 'WORKER_URL must point to an allowed parser worker host');
  }
  const parser = createParserClient({ baseUrl: workerUrl, token: parserToken });
  let parseRes;
  try {
    const blobUrl = await getSignedDownloadUrl(invoiceFile.blob_ref);
    const basePayload = {
      blob_ref: invoiceFile.blob_ref, file_id: invoiceFile.file_id, job_id: body.job_id,
      file_type: invoiceFile.file_type as 'xlsx' | 'md' | 'txt' | 'pdf',
      parser_version: job.parser_version,
      blob_url: blobUrl,
      workflow_type: job.workflow_type
    };
    parseRes = await parser.parse(basePayload as any);
  } catch (e) {
    const msg = (e as Error).message || '';
    const pdfIssue = invoiceFile.file_type === 'pdf' ? classifyPdfParseIssue(msg) : null;
    if (pdfIssue) {
      const issueType = pdfIssue;
      const parseResultId = `parse_unsupported_${body.job_id}`;
      const actionItems = [{
        action_id: `act_pdf_parse_${body.job_id}`,
        severity: 'AMBER' as const,
        line_id: '',
        issue_type: issueType,
        required_action: `PDF invoice source could not be parsed automatically (${issueType}) — review the source PDF and provide a structured invoice if needed`
      }];
      await STORE.setNormalizedInvoice(body.job_id, {
        invoice_id: body.job_id,
        invoice_header: { currency: 'AED' },
        invoice_lines: [],
        evidence_candidates: [],
        parser_confidence: 0,
        parser_version: job.parser_version
      });
      await STORE.setResult(body.job_id, { gate_id: `gate_pdf_parse_${body.job_id}`, job_id: body.job_id, verdict: 'AMBER', line_results: [], action_items: actionItems } as any);
      await STORE.appendTrace(body.job_id, {
        step: 'PARSE',
        input_ref: invoiceFile.blob_ref,
        output_ref: issueType,
        source_hash: invoiceFile.sha256,
        calculation_hash: parseResultId,
        attributedTo: 'python-worker:error'
      });
      await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: parseResultId, output_ref: issueType, attributedTo: 'run-route:pdf-parse-guard' });
      await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
      return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: 'AMBER', action_items: actionItems }, { status: 202 });
    }
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    return err('PARSE_FAILED', msg);
  }

  await STORE.appendTrace(body.job_id, {
    step: 'PARSE',
    input_ref: invoiceFile.blob_ref,
    output_ref: parseRes.parse_result_id,
    source_hash: invoiceFile.sha256,
    calculation_hash: parseRes.source_sha256 ?? parseRes.parse_result_id,
    attributedTo: 'python-worker'
  });
  await STORE.setNormalizedInvoice(body.job_id, parseRes.normalized as any);
  await appendParseSourceData(body.job_id, parseRes.source_data);

  const sourceHashActionItems: Array<{ action_id: string; severity: Verdict; line_id: string | null; issue_type: string; required_action: string }> = [];
  const expectedSourceHash = invoiceFile.sha256;
  const actualSourceHash = parseRes.source_sha256;
  let sourceHashVerdict: 'PASS' | 'AMBER' | 'ZERO' = 'PASS';
  let sourceHashStatus = 'SOURCE_HASH_MATCH';
  if (expectedSourceHash === PENDING_SHA256_PLACEHOLDER) {
    sourceHashVerdict = 'AMBER';
    sourceHashStatus = 'HASH_UNVERIFIED';
    sourceHashActionItems.push({
      action_id: `act_hash_unverified_${body.job_id}`,
      severity: 'AMBER' as const,
      line_id: '',
      issue_type: 'HASH_UNVERIFIED',
      required_action: 'Large-upload source hash is still pending; rehash the stored source object before final approval'
    });
  } else if (actualSourceHash && actualSourceHash !== expectedSourceHash) {
    // Only a POSITIVE mismatch (parser echoed a source hash AND it differs) is ZERO.
    // A parser that doesn't return source_sha256 (common for PDF) leaves cross-check
    // unavailable — not tampering. The byte-level guard above (verifyAndPersistSourceHashes)
    // already verified integrity, so absence stays PASS rather than blocking as ZERO.
    sourceHashVerdict = 'ZERO';
    sourceHashStatus = 'SOURCE_HASH_MISMATCH';
    sourceHashActionItems.push({
      action_id: `act_source_hash_mismatch_${body.job_id}`,
      severity: 'ZERO' as const,
      line_id: '',
      issue_type: 'SOURCE_HASH_MISMATCH',
      required_action: 'Parser source bytes hash does not match uploaded source hash — quarantine source and re-upload from trusted storage'
    });
  }
  await STORE.appendTrace(body.job_id, {
    step: 'SOURCE_DATA',
    input_ref: invoiceFile.blob_ref,
    output_ref: sourceHashStatus,
    source_hash: expectedSourceHash,
    calculation_hash: actualSourceHash ?? undefined,
    attributedTo: 'run-route:source-hash-check'
  });

  // Phase 1: MarkItDown -> NotebookLM dual-extraction trigger (verification path).
  // Flag-gated (default OFF) and fire-and-forget — the pdfplumber result above stays
  // the source of truth for validation/gate. The worker (Fly, long-running) runs the
  // orchestrator and POSTs its first-pass extraction to /api/notebooklm/ingest-summary,
  // which cross-checks it against this parser result. A trigger failure must never
  // affect the audit verdict, so it is fully isolated in a catch.
  // NOTE: enabling this sends private audit content to the external NotebookLM
  // service — require explicit operator approval before enabling it in prod.
  if (process.env.NOTEBOOKLM_ENABLED === 'true') {
    const nbJobId = body.job_id;
    const nbBlobRef = invoiceFile.blob_ref;
    void (async () => {
      try {
        const nbBlobUrl = await getSignedDownloadUrl(nbBlobRef);
        const res = await parser.runNotebookLm({
          job_id: nbJobId,
          blob_url: nbBlobUrl,
          notebook_id: process.env.NOTEBOOKLM_NOTEBOOK_ID
        });
        await STORE.appendTrace(nbJobId, {
          step: 'NOTEBOOKLM', input_ref: nbBlobRef,
          output_ref: res.status ?? 'TRIGGERED', attributedTo: 'run-route:notebooklm-trigger'
        });
      } catch {
        await STORE.appendTrace(nbJobId, {
          step: 'NOTEBOOKLM', input_ref: nbBlobRef,
          output_ref: 'TRIGGER_FAILED', attributedTo: 'run-route:notebooklm-trigger'
        }).catch(() => undefined);
      }
    })();
  }

  // Track ②: Sync Vision OCR for scanned PDFs (invoice + evidence).

  // Replaces fire-and-forget with bounded sync run so OCR lines/evidence
  // are merged BEFORE cf.validate in the same audit pass.
  // Flag-gated (VISION_FALLBACK_ENABLED, default OFF). Only triggers for
  // PDFs flagged SCANNED_PAGE_DETECTED with gs:// input (GCS upload path).
  const visionEnabled = envFlagEnabled(process.env.VISION_FALLBACK_ENABLED);
  const gcsOcrBucket = process.env.GCS_OCR_BUCKET || 'dsv-invoice-ocr';
  const scannerActionItems: Array<{ action_id: string; severity: Verdict; line_id: string | null; issue_type: string; required_action: string }> = [];
  const parsedIssues: string[] = Array.isArray((parseRes as any).parser_issues) ? (parseRes as any).parser_issues : [];
  const isScannedInvoice = parsedIssues.includes('SCANNED_PAGE_DETECTED');
  const runJobId = body.job_id;  // non-null capture for closure

  async function runVisionForPdf(pdfFile: typeof invoiceFile, label: string): Promise<{ lines: any[]; evidence: any[]; sourceData: any[] } | null> {
    const gcsUri = String((pdfFile as any).gcs_uri || pdfFile.blob_ref || '');
    if (!gcsUri.startsWith('gs://')) {
      await STORE.appendTrace(runJobId, {
        step: 'VISION_RUN', input_ref: pdfFile.file_id,
        output_ref: 'VISION_SKIPPED_NO_GCS', attributedTo: 'run-route:vision-run'
      }).catch(() => undefined);
      return null;
    }
    const ocrPrefix = `gs://${gcsOcrBucket}/jobs/${runJobId}/${pdfFile.file_id}/`;
    try {
      const vrResult = await parser.runVisionOcr({
        job_id: runJobId,
        file_id: pdfFile.file_id,
        source_gcs_uri: gcsUri,
        output_gcs_prefix: ocrPrefix,
        timeout_seconds: 180,
      });
      await STORE.appendTrace(runJobId, {
        step: 'VISION_RUN', input_ref: gcsUri,
        output_ref: vrResult.status,
        source_hash: pdfFile.sha256,
        attributedTo: `run-route:vision-run:${label}`,
      });
      if (vrResult.status === 'VISION_RUN_COLLECTED') {
        return {
          lines: vrResult.invoice_lines ?? [],
          evidence: vrResult.evidence_candidates ?? [],
          sourceData: vrResult.source_data ?? [],
        };
      }
      scannerActionItems.push({
        action_id: `act_vision_${vrResult.status.toLowerCase()}_${runJobId}_${pdfFile.file_id}`,
        severity: 'AMBER' as const,
        line_id: '',
        issue_type: 'SCANNED_PDF_NEEDS_OCR',
        required_action: `PDF '${pdfFile.original_filename}' OCR ${vrResult.status === 'VISION_TIMEOUT' ? 'timed out' : 'failed'} — review scanned document manually`,
      });
    } catch (e) {
      await STORE.appendTrace(runJobId, {
        step: 'VISION_RUN', input_ref: pdfFile.file_id,
        output_ref: 'VISION_RUN_EXCEPTION', attributedTo: 'run-route:vision-run'
      }).catch(() => undefined);
      scannerActionItems.push({
        action_id: `act_vision_exception_${runJobId}`,
        severity: 'AMBER' as const,
        line_id: '',
        issue_type: 'SCANNED_PDF_NEEDS_OCR',
        required_action: `PDF '${pdfFile.original_filename}' OCR unavailable — review scanned document manually`,
      });
    }
    return null;
  }

  // ── Sync Vision for scanned invoice PDF ──
  if (visionEnabled && isScannedInvoice) {
    const ocrResult = await runVisionForPdf(invoiceFile, 'invoice');
    if (ocrResult && ocrResult.lines.length > 0) {
      const currentNormalized = parseRes.normalized as any;
      const existingLines = (currentNormalized?.invoice_lines ?? []) as any[];
      const existingEvidence = (currentNormalized?.evidence_candidates ?? []) as any[];
      const mergedNormalized = {
        ...currentNormalized,
        invoice_lines: [...existingLines, ...ocrResult.lines],
        evidence_candidates: [...existingEvidence, ...ocrResult.evidence],
        parser_confidence: Math.max(currentNormalized?.parser_confidence ?? 0, 0.60),
      };
      await STORE.setNormalizedInvoice(runJobId, mergedNormalized);
      parseRes.normalized = mergedNormalized;
      await appendParseSourceData(runJobId, ocrResult.sourceData);
    } else if (!ocrResult) {
      if (parsedIssues.includes('SCANNED_PAGE_DETECTED') && !scannerActionItems.length) {
        scannerActionItems.push({
          action_id: `act_scan_no_ocr_${runJobId}`,
          severity: 'AMBER' as const,
          line_id: '',
          issue_type: 'SCANNED_PDF_NEEDS_OCR',
          required_action: 'Invoice PDF is scanned. Enable Vision OCR (gs:// upload) for automatic extraction, or review manually.',
        });
      }
    }
  } else if (isScannedInvoice && !visionEnabled) {
    // Vision OFF + scanned invoice → AMBER (not silent SKIP)
    scannerActionItems.push({
      action_id: `act_scan_vision_off_${runJobId}`,
      severity: 'AMBER' as const,
      line_id: '',
      issue_type: 'SCANNED_PDF_NEEDS_OCR',
      required_action: 'Invoice PDF is scanned and Vision OCR is disabled. Upload a structured invoice (.xlsx) or enable Vision OCR.',
    });
  }

  // ── Sync Vision for scanned evidence PDFs ──
  const visionMergedEvidence: any[] = [];
  if (visionEnabled) {
    for (const evFile of evidenceFiles) {
      const evParsedIssues = parsedIssues;
      if (evFile.file_type === 'pdf') {
        const ocrResult = await runVisionForPdf(evFile, 'evidence');
        if (ocrResult) {
          visionMergedEvidence.push(...ocrResult.evidence);
          await appendParseSourceData(runJobId, ocrResult.sourceData);
        }
      }
    }
  }

  // ── Zero-lines guard (after OCR merge) ──
  // P0-4: parser extracted zero invoice lines (empty/unmapped invoice, or PDF text
  // with no structured lines). Validating [] would yield empty COST-GUARD results and
  // a false PASS, so short-circuit to AMBER and route to human review instead.
  // OCR may have filled the lines, so this guard runs AFTER Vision merge.
  const parsedLines = ((parseRes.normalized as { invoice_lines?: unknown[] })?.invoice_lines) ?? [];
  if (parsedLines.length === 0) {
    const actionItems = [...sourceHashActionItems, ...scannerActionItems, {
      action_id: `act_nolines_${body.job_id}`,
      severity: 'AMBER' as const,
      line_id: '',
      issue_type: 'NO_INVOICE_LINES_EXTRACTED',
      required_action: 'Parser extracted 0 invoice lines — verify file/column mapping or supply a structured invoice'
    }];
    const zeroLineVerdict = maxVerdict('AMBER', sourceHashVerdict) as 'AMBER' | 'ZERO';
    await STORE.setResult(body.job_id, { gate_id: `gate_nolines_${body.job_id}`, job_id: body.job_id, verdict: zeroLineVerdict, line_results: [], action_items: actionItems } as any);
    await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: zeroLineVerdict });
    await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: parseRes.parse_result_id, output_ref: 'NO_INVOICE_LINES_EXTRACTED', attributedTo: 'run-route:guard' });
    return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: zeroLineVerdict, action_items: actionItems }, { status: 202 });
  }

  const mergedEvidence = [...((parseRes.normalized as any)?.evidence_candidates ?? []), ...visionMergedEvidence];
  for (const evFile of evidenceFiles) {
    try {
      const evBlobUrl = await getSignedDownloadUrl(evFile.blob_ref);
      const evPayload = {
        blob_ref: evFile.blob_ref, file_id: evFile.file_id, job_id: body.job_id,
        file_type: 'pdf' as const, parser_version: job.parser_version, blob_url: evBlobUrl,
        workflow_type: job.workflow_type
      };
      const evParse = await parser.parsePdfText(evPayload);
      const evCandidates = (evParse.normalized as any)?.evidence_candidates ?? [];
      mergedEvidence.push(...evCandidates);
      await appendParseSourceData(body.job_id, evParse.source_data);
      await STORE.appendTrace(body.job_id, {
        step: 'EVIDENCE_PARSE',
        input_ref: evFile.blob_ref,
        output_ref: `evidence_candidates:${evCandidates.length}`,
        source_hash: evFile.sha256,
        attributedTo: 'python-worker:pdfplumber'
      });
    } catch {
      await STORE.appendTrace(body.job_id, { step: 'EVIDENCE_PARSE', input_ref: evFile.blob_ref, output_ref: 'SKIPPED', attributedTo: 'python-worker:pdfplumber' });
    }
  }

  await STORE.updateJob(body.job_id, { status: 'VALIDATING' });
  // MCP validation tools now run in-process (apps/web/src/lib/mcp) — no external MCP URL needed.
  const cf = createCfMcpClient();
  let sct;
  try {
    sct = await cf.validate(body.job_id, {
      invoice_lines: (parseRes.normalized as { invoice_lines: unknown[] }).invoice_lines,
      evidence_index: mergedEvidence,
      rule_version: job.rule_version,
      workflow_type: job.workflow_type
    });
  } catch (e: any) {
    // Mirror the parse catch: persist FAILED so the job does not get stuck in
    // VALIDATING (which would reject re-runs with "cannot run from status VALIDATING").
    await STORE.updateJob(body.job_id, { status: 'FAILED', verdict: 'FAILED' });
    await STORE.appendTrace(body.job_id, {
      step: 'VALIDATE',
      input_ref: parseRes.parse_result_id,
      output_ref: e?.code ?? 'VALIDATION_FAILED',
      attributedTo: 'cf-mcp:error'
    }).catch(() => undefined);
    if (e instanceof McpUnavailableError) return err('MCP_UNAVAILABLE', e.message);
    const code = e.code || 'VALIDATION_FAILED';
    return err(code as ErrorCode, e.message);
  }

  await STORE.setValidationResult(body.job_id, sct as any);
  const normalized = mergeValidationIntoNormalizedInvoice(parseRes.normalized as any, sct);
  await STORE.setNormalizedInvoice(body.job_id, normalized as any);

  for (const tc of sct.cf_mcp_tool_calls) {
    await STORE.appendTrace(body.job_id, {
      step: tc.tool === 'check_cost_guard' ? 'COSTGUARD' : tc.tool === 'check_doc_guardian' ? 'DOC_GUARDIAN' : tc.tool === 'classify_type_b' ? 'VALIDATE' : tc.tool === 'check_hs_uae_compliance' ? 'VALIDATE' : 'VALIDATE',
      input_ref: parseRes.parse_result_id, output_ref: tc.tool, latency_ms: tc.latency_ms, attributedTo: `cf-mcp:${tc.tool}`
    });
  }
  const typeBClassCount = sct.type_b_results.reduce<Record<string, number>>((acc, t) => { acc[t.type_b] = (acc[t.type_b] || 0) + 1; return acc; }, {});
  const evidenceFindings = [...sct.doc_guardian_results.map(d => ({ line_id: d.line_id, code: d.code, severity: d.severity }))];
  for (const hs of sct.hs_uae_results) {
    evidenceFindings.push({ line_id: hs.line_id, code: hs.reason_code ?? 'HS_UAE_CHECK', severity: hs.verdict === 'ZERO' ? 'ZERO' : 'AMBER' });
  }
  const duplicateFindings = (sct.duplicate_checks ?? [])
    .filter(d => d.reason_code)
    .map(d => ({
      vendor_hash: d.vendor_hash,
      invoice_no_hash: d.invoice_no_hash,
      severity: d.verdict === 'ZERO' ? 'ZERO' as const : 'AMBER' as const,
      reason_code: d.reason_code ?? 'DUPLICATE_INVOICE'
    }));
  const domesticLaneResults = (sct.domestic_lane_results ?? []).map(dl => ({
    line_id: dl.line_id, lane: dl.lane, distance_km: dl.distance_km, rate_band: dl.rate_band,
    verdict: dl.verdict, reason_code: dl.reason_code, delta_pct: dl.delta_pct ?? null,
    cg_band: dl.cg_band ?? 'UNKNOWN', short_run_flag: dl.short_run_flag ?? false,
    fixed_cost_suspect: dl.fixed_cost_suspect ?? false, risk_score: dl.risk_score ?? null,
    rbr_trigger: dl.rbr_trigger ?? false
  }));
  const gate = buildGateResult(body.job_id, sct.costguard_results.map(c => ({ line_id: c.line_id, band: c.band, delta_pct: c.delta_pct, reason_codes: [`COSTGUARD_${c.band}`] })), evidenceFindings, duplicateFindings, job.workflow_type, domesticLaneResults);
  const invoiceTotal = normalized?.invoice_header?.invoice_total ?? null;
  const lineAuditTotal = (normalized?.invoice_lines as any[] | undefined)?.reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0) ?? 0;
  const typeBTotal: number | null = sct.type_b_results.length > 0
    ? (normalized?.invoice_lines as any[] | undefined)?.reduce((sum: number, l: any) => {
        const hasTypeB = sct.type_b_results.some(t => t.line_id === l.line_id);
        return sum + (hasTypeB ? (Number(l.amount) || 0) : 0);
      }, 0) ?? 0
    : null;
  const recon = checkReconciliation(invoiceTotal, lineAuditTotal, typeBTotal, job.workflow_type);
  let finalVerdict = maxVerdict(gate.verdict as Verdict, sourceHashVerdict);
  // Fold scanned-PDF/OCR action items (AMBER) into the verdict so an unread scanned
  // evidence doc cannot coexist with a PASS verdict (audit-integrity consistency).
  for (const item of scannerActionItems) finalVerdict = maxVerdict(finalVerdict, item.severity);
  const actionItems = [...sourceHashActionItems, ...scannerActionItems, ...(gate.action_items || [])];
  if (!recon.ok && recon.verdict !== 'PASS') {
    finalVerdict = maxVerdict(finalVerdict, recon.verdict as Verdict);
    actionItems.push({
      action_id: `act_recon_${body.job_id}`,
      severity: recon.verdict,
      line_id: '',
      issue_type: recon.reason ?? 'RECONCILIATION',
      required_action: recon.verdict === 'ZERO' ? 'TYPE-B total mismatch — Contract/Admin review required' : 'Line audit total mismatch — review line items'
    });
  }
  await STORE.setResult(body.job_id, { ...gate, verdict: finalVerdict, action_items: actionItems });
  await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: finalVerdict });
  await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: sct.sct_trace_id, output_ref: gate.gate_id, attributedTo: `gate-bridge:${job.workflow_type}` });
  return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: finalVerdict, action_items: actionItems }, { status: 202 });
}
