import { z } from 'zod';

export const CurrencySchema = z.enum(['AED', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

export const RateBasisSchema = z.enum(['PER_EA', 'PER_TRUCK', 'PER_TEU', 'PER_CBM', 'PER_MT', 'PER_DAY', 'AT_COST', 'LUMP_SUM']);
export type RateBasis = z.infer<typeof RateBasisSchema>;

export const VerdictSchema = z.enum(['PASS', 'AMBER', 'ZERO', 'FAILED']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const InvoiceHeaderSchema = z.object({
  invoice_no: z.string().nullish(),
  vendor: z.string().nullish(),
  issue_date: z.string().nullish(),
  currency: CurrencySchema,
  invoice_total: z.number().nullish()
});
export type InvoiceHeader = z.infer<typeof InvoiceHeaderSchema>;

export const EvidenceCandidateSchema = z.object({
  source_file_id: z.string(),
  text_span: z.string(),
  matched_reference: z.string().nullish(),
  confidence: z.number().min(0).max(1)
});
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;

export const InvoiceLineSchema = z.object({
  line_id: z.string(),
  shipment_ref: z.string().nullish(),
  job_number: z.string().nullish(),
  description: z.string(),
  normalized_description: z.string().nullish(),
  qty: z.number().nullish(),
  rate: z.number().nullish(),
  rate_basis: RateBasisSchema.nullish(),
  currency: CurrencySchema,
  amount: z.number(),
  numeric_integrity_status: z.enum(['PASS', 'AMBER']).nullish(),
  numeric_delta: z.number().nullish(),
  rate_source_candidate: z.enum(['CONTRACT', 'AT_COST', 'DSV_HANDLING', 'UNKNOWN']).nullish(),
  for_charge_component: z.string().nullish(),
  type_b: z.string().nullish(),
  evidence_status: z.enum(['MATCHED', 'PARTIAL', 'MISSING']).nullish(),
  rate_status: z.enum(['MATCHED', 'UNKNOWN', 'MISMATCH', 'NOT_APPLICABLE']).nullish(),
  validity_status: z.enum(['VALID', 'EXPIRED', 'PENDING']).nullish(),
  gate_status: VerdictSchema.nullish(),
  band: z.enum(['PASS', 'WARN', 'HIGH', 'CRITICAL']).nullish(),
  delta_pct: z.number().nullish(),
  source_ref: z.object({ sheet: z.string().optional(), row: z.number().optional(), col: z.string().optional(), text_span: z.string().optional() }).nullish()
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const NormalizedInvoiceSchema = z.object({
  invoice_id: z.string(),
  invoice_header: InvoiceHeaderSchema,
  invoice_lines: z.array(InvoiceLineSchema),
  evidence_candidates: z.array(EvidenceCandidateSchema),
  parser_confidence: z.number().min(0).max(1),
  parser_version: z.string()
});
export type NormalizedInvoice = z.infer<typeof NormalizedInvoiceSchema>;
