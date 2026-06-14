import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NormalizedInvoiceSchema } from '@invoice-audit/contracts/invoice';
import type { NormalizedInvoice } from './types';

const NullableString = z.string().trim().min(1).nullable().optional();
const NullableNumber = z.number().finite().nullable().optional();

export const NOTEBOOKLM_EXTRACTION_PROMPT = `Extract the invoice or DSV waybill fields from this Markdown source.
Return JSON only. Do not include prose, markdown fences, comments, or explanations.
Do not invent values. Use null when a value is not present.
Required JSON shape:
{
  "doc_kind": "INVOICE or DSV_WAYBILL or UNKNOWN",
  "fields": {
    "invoice_no": null,
    "waybill_no": null,
    "order_no": null,
    "job_no": null,
    "po_no": null,
    "do_no": null,
    "bol_no": null,
    "trip_no": null,
    "vendor": null,
    "issue_date": null,
    "currency": "AED or USD or null",
    "amount": null
  },
  "consignment_table": {},
  "lane": {
    "origin_raw": null,
    "destination_raw": null,
    "origin_norm": null,
    "destination_norm": null,
    "extraction_method": null
  },
  "timeline": {},
  "shipment_ids": [],
  "document_numbers": [],
  "dates": [],
  "amounts": [],
  "confidence": 0,
  "flags": []
}`;

export const NotebookLmSummarySchema = z.object({
  doc_kind: z.string().default('UNKNOWN'),
  fields: z.object({
    invoice_no: NullableString,
    waybill_no: NullableString,
    order_no: NullableString,
    job_no: NullableString,
    po_no: NullableString,
    do_no: NullableString,
    bol_no: NullableString,
    trip_no: NullableString,
    vendor: NullableString,
    issue_date: NullableString,
    currency: z.enum(['AED', 'USD']).nullable().optional(),
    amount: NullableNumber,
    printed_date: NullableString,
    cust_ref: NullableString,
    loading_address: NullableString,
    destination: NullableString
  }).passthrough().default({}),
  consignment_table: z.record(z.unknown()).default({}),
  lane: z.object({
    origin_raw: NullableString,
    destination_raw: NullableString,
    origin_norm: NullableString,
    destination_norm: NullableString,
    extraction_method: NullableString
  }).passthrough().default({}),
  timeline: z.record(z.unknown()).default({}),
  shipment_ids: z.array(z.string()).default([]),
  document_numbers: z.array(z.string()).default([]),
  dates: z.array(z.string()).default([]),
  amounts: z.array(z.union([z.string(), z.number()])).default([]),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string()).default([])
}).passthrough();
export type NotebookLmSummary = z.infer<typeof NotebookLmSummarySchema>;

export const ParserCompatibleResultSchema = z.object({
  doc_kind: z.string(),
  fields: z.record(z.unknown()),
  consignment_table: z.record(z.unknown()),
  lane: z.record(z.unknown()),
  timeline: z.record(z.unknown()),
  shipment_ids: z.array(z.string()),
  document_numbers: z.array(z.string()),
  dates: z.array(z.string()),
  amounts: z.array(z.union([z.string(), z.number()])),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string()),
  success: z.boolean(),
  normalized: NormalizedInvoiceSchema
});
export type ParserCompatibleResult = z.infer<typeof ParserCompatibleResultSchema>;

export const NotebookLmCallbackPayloadSchema = z.object({
  job_id: z.string().min(1),
  notebook_id: z.string().min(1).optional(),
  notebooklm_source_id: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
  summary: NotebookLmSummarySchema.optional(),
  summary_json: NotebookLmSummarySchema.optional(),
  markdown_sha256: z.string().length(64).optional(),
  source_sha256: z.string().length(64).optional(),
  source_hash: z.string().length(64).optional(),
  received_at: z.string().datetime().optional()
}).superRefine((value, ctx) => {
  if (!value.notebooklm_source_id && !value.source_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source_id'], message: 'source_id or notebooklm_source_id required' });
  }
  if (!value.summary && !value.summary_json) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'summary or summary_json required' });
  }
}).transform((value) => ({
  job_id: value.job_id,
  notebook_id: value.notebook_id ?? null,
  notebooklm_source_id: value.notebooklm_source_id ?? value.source_id!,
  summary: value.summary ?? value.summary_json!,
  markdown_sha256: value.markdown_sha256,
  source_sha256: value.source_sha256 ?? value.source_hash,
  received_at: value.received_at
}));
export type NotebookLmCallbackPayload = z.infer<typeof NotebookLmCallbackPayloadSchema>;

export const HIGH_IMPACT_FIELDS = [
  'invoice_no',
  'waybill_no',
  'order_no',
  'job_no',
  'po_no',
  'do_no',
  'bol_no',
  'trip_no',
  'origin_norm',
  'destination_norm',
  'amount',
  'currency'
] as const;
export type HighImpactField = typeof HIGH_IMPACT_FIELDS[number];

export interface ExtractionMismatch {
  field: HighImpactField;
  parser_value: unknown;
  notebooklm_value: unknown;
  parser_value_hash: string | null;
  notebooklm_value_hash: string | null;
  impact: 'HIGH';
}

export interface NotebookLmGateIssue {
  code: 'NOTEBOOKLM_LOW_CONFIDENCE' | 'NOTEBOOKLM_AMOUNT_MISSING' | 'NOTEBOOKLM_IDENTIFIER_MISSING' | 'NOTEBOOKLM_CURRENCY_MISSING';
  field: 'confidence' | 'amount' | 'identifier' | 'currency';
  severity: 'AMBER';
}

export function adaptNotebookLmToParserResult(summary: NotebookLmSummary): ParserCompatibleResult {
  const fields = summary.fields ?? {};
  const lane = summary.lane ?? {};
  const currency = fields.currency ?? 'AED';
  const amount = toNumber(fields.amount ?? firstAmount(summary.amounts));
  const primaryRef = firstPresent(fields.waybill_no, fields.order_no, fields.job_no, fields.po_no, summary.shipment_ids[0]);
  const invoiceNo = fields.invoice_no ?? fields.waybill_no ?? `notebooklm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const lineAmount = amount ?? 0;
  const description = firstPresent(fields.description, fields.waybill_no, summary.doc_kind) ?? 'NotebookLM extracted invoice summary';

  const normalized: NormalizedInvoice = {
    invoice_id: String(invoiceNo),
    invoice_header: {
      invoice_no: fields.invoice_no ?? fields.waybill_no ?? null,
      vendor: fields.vendor ?? null,
      issue_date: fields.issue_date ?? fields.printed_date ?? null,
      currency,
      invoice_total: amount
    },
    invoice_lines: amount === null ? [] : [{
      line_id: 'nlm_line_1',
      shipment_ref: primaryRef ?? null,
      job_number: fields.job_no ?? null,
      description,
      normalized_description: summary.doc_kind,
      qty: null,
      rate: null,
      rate_basis: null,
      currency,
      amount: lineAmount,
      numeric_integrity_status: null,
      numeric_delta: null,
      rate_source_candidate: 'UNKNOWN',
      for_charge_component: null,
      type_b: null,
      source_ref: { text_span: 'notebooklm_summary' }
    }],
    evidence_candidates: [{
      source_file_id: 'notebooklm',
      text_span: `notebooklm:${summary.doc_kind}`,
      matched_reference: primaryRef ?? null,
      confidence: summary.confidence
    }],
    parser_confidence: summary.confidence,
    parser_version: 'notebooklm-first-pass-0.1.0'
  };

  return ParserCompatibleResultSchema.parse({
    doc_kind: summary.doc_kind,
    fields,
    consignment_table: summary.consignment_table,
    lane,
    timeline: summary.timeline,
    shipment_ids: summary.shipment_ids,
    document_numbers: summary.document_numbers,
    dates: summary.dates,
    amounts: summary.amounts,
    confidence: summary.confidence,
    flags: summary.flags,
    success: true,
    normalized
  });
}

export function compareParserAndNotebookLm(
  parserResult: NormalizedInvoice | undefined,
  notebookResult: ParserCompatibleResult
): ExtractionMismatch[] {
  if (!parserResult) return [];

  const parserValues = extractComparableValues(parserResult);
  const notebookValues = extractComparableValues(notebookResult.normalized, notebookResult);

  return HIGH_IMPACT_FIELDS.flatMap((field) => {
    const parserValue = normalizeComparable(parserValues[field]);
    const notebookValue = normalizeComparable(notebookValues[field]);
    if (parserValue === null && notebookValue === null) return [];
    if (parserValue !== null && notebookValue !== null && parserValue === notebookValue) return [];
    return [{
      field,
      parser_value: parserValues[field],
      notebooklm_value: notebookValues[field],
      parser_value_hash: hashValue(parserValues[field]),
      notebooklm_value_hash: hashValue(notebookValues[field]),
      impact: 'HIGH' as const
    }];
  });
}

export function findNotebookLmGateIssues(summary: NotebookLmSummary): NotebookLmGateIssue[] {
  const issues: NotebookLmGateIssue[] = [];
  const fields = summary.fields ?? {};
  const amount = toNumber(fields.amount ?? firstAmount(summary.amounts));
  const hasIdentifier = [
    fields.invoice_no,
    fields.waybill_no,
    fields.order_no,
    fields.job_no,
    fields.po_no,
    fields.do_no,
    fields.bol_no,
    fields.trip_no,
    summary.shipment_ids[0],
    summary.document_numbers[0]
  ].some((value) => typeof value === 'string' && value.trim().length > 0);

  if (summary.confidence < 0.85) {
    issues.push({ code: 'NOTEBOOKLM_LOW_CONFIDENCE', field: 'confidence', severity: 'AMBER' });
  }
  if (amount === null) {
    issues.push({ code: 'NOTEBOOKLM_AMOUNT_MISSING', field: 'amount', severity: 'AMBER' });
  }
  if (!hasIdentifier) {
    issues.push({ code: 'NOTEBOOKLM_IDENTIFIER_MISSING', field: 'identifier', severity: 'AMBER' });
  }
  if (!fields.currency) {
    issues.push({ code: 'NOTEBOOKLM_CURRENCY_MISSING', field: 'currency', severity: 'AMBER' });
  }

  return issues;
}

export function summarizeMismatchesForTrace(mismatches: ExtractionMismatch[]) {
  return mismatches.map(({ field, parser_value_hash, notebooklm_value_hash, impact }) => ({
    field,
    parser_value_hash,
    notebooklm_value_hash,
    impact
  }));
}

export function hashValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex');
}

function extractComparableValues(
  normalized: NormalizedInvoice,
  parserCompatible?: ParserCompatibleResult
): Partial<Record<HighImpactField, unknown>> {
  const header = normalized.invoice_header;
  const firstLine = normalized.invoice_lines[0];
  const fields = parserCompatible?.fields as Record<string, unknown> | undefined;
  const lane = parserCompatible?.lane as Record<string, unknown> | undefined;

  return {
    invoice_no: header.invoice_no ?? fields?.invoice_no,
    waybill_no: fields?.waybill_no ?? firstLine?.shipment_ref,
    order_no: fields?.order_no,
    job_no: firstLine?.job_number ?? fields?.job_no,
    po_no: fields?.po_no,
    do_no: fields?.do_no,
    bol_no: fields?.bol_no,
    trip_no: fields?.trip_no,
    origin_norm: lane?.origin_norm,
    destination_norm: lane?.destination_norm,
    amount: header.invoice_total ?? firstLine?.amount,
    currency: header.currency ?? firstLine?.currency
  };
}

function normalizeComparable(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : null;
  return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
}

function firstPresent(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstAmount(amounts: Array<string | number>): number | null {
  for (const amount of amounts) {
    const parsed = toNumber(amount);
    if (parsed !== null) return parsed;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}
