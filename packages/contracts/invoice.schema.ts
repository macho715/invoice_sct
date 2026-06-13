import { z } from 'zod';

export const CurrencySchema = z.enum(['AED', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

export const RateBasisSchema = z.enum(['PER_EA', 'PER_TRUCK', 'PER_TEU', 'PER_CBM', 'PER_MT', 'PER_DAY', 'AT_COST', 'LUMP_SUM']);
export type RateBasis = z.infer<typeof RateBasisSchema>;

export const VerdictSchema = z.enum(['PASS', 'AMBER', 'ZERO', 'FAILED']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const InvoiceHeaderSchema = z.object({
  invoice_no: z.string().nullable(),
  vendor: z.string().nullable(),
  issue_date: z.string().nullable(),
  currency: CurrencySchema,
  invoice_total: z.number().nullable()
});
export type InvoiceHeader = z.infer<typeof InvoiceHeaderSchema>;

export const InvoiceLineSchema = z.object({
  line_id: z.string(),
  shipment_ref: z.string().nullable(),
  job_number: z.string().nullable(),
  description: z.string(),
  normalized_description: z.string().nullable(),
  qty: z.number().nullable(),
  rate: z.number().nullable(),
  rate_basis: RateBasisSchema.nullable(),
  currency: CurrencySchema,
  amount: z.number(),
  numeric_integrity_status: z.enum(['PASS', 'AMBER']).nullable(),
  numeric_delta: z.number().nullable(),
  rate_source_candidate: z.enum(['CONTRACT', 'AT_COST', 'DSV_HANDLING', 'UNKNOWN']).nullable(),
  for_charge_component: z.string().nullable(),
  type_b: z.string().nullable(),
  source_ref: z.record(z.unknown()).nullable()
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const NormalizedInvoiceSchema = z.object({
  invoice_id: z.string(),
  invoice_header: InvoiceHeaderSchema,
  invoice_lines: z.array(InvoiceLineSchema),
  evidence_candidates: z.array(z.object({
    source_file_id: z.string(),
    text_span: z.string(),
    matched_reference: z.string().nullable(),
    confidence: z.number().min(0).max(1)
  })),
  parser_confidence: z.number().min(0).max(1),
  parser_version: z.string()
});
export type NormalizedInvoice = z.infer<typeof NormalizedInvoiceSchema>;
