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

// Rate_Type taxonomy — see rate_match_logic.md §3 (A/B/C/D/E)
export const RateTypeSchema = z.enum([
  'CONTRACT_NUMERIC',
  'TEXT_EXCEPTION',
  'MISSING_RATE'
]);

// AI_Rate_Status — see rate_match_logic.md §11
export const AiRateStatusSchema = z.enum([
  'AUTO_COMPARE_OK',
  'AUTO_COMPARE_WITH_DUPLICATE_REVIEW',
  'AUTO_COMPARE_REQUIRE_REVIEW_EVIDENCE',
  'EXCEPTION_EVIDENCE_REQUIRED',
  'MISSING_RATE_NO_AUTO_PASS'
]);

// Evidence_Status — see rate_match_logic.md §7
export const EvidenceStatusSchema = z.enum([
  'MATCHED_EXACT',
  'MATCHED_AMOUNT',
  'MATCHED_APPROVAL',
  'PARTIAL',
  'MISSING',
  'CONFLICT',
  'NOT_APPLICABLE'
]);

// Risk band — see rate_match_logic.md §9
export const RiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const InvoiceLineSchema = z.object({
  line_id: z.string(),
  shipment_ref: z.string().nullish(),
  job_number: z.string().nullish(),
  description: z.string(),
  normalized_description: z.string().nullish(),
  qty: z.number().nullish(),
  rate: z.number().nullish(),
  // contract_rate is the contracted unit rate (raw, [PRIVATE] masked on export).
  // Distinct from `rate` (invoice unit rate) so 06_Rate_Check can render both.
  contract_rate: z.number().nullish(),
  rate_basis: RateBasisSchema.nullish(),
  // Unit (per B/L, per truck, per RT …) — see rate_match_logic.md §2.
  unit: z.string().nullish(),
  // Scope (Cargo_Category / Container_Type / Detail_Cargo / MT·LWH) — §2.
  scope: z.string().nullish(),
  currency: CurrencySchema,
  amount: z.number(),
  numeric_integrity_status: z.enum(['PASS', 'AMBER']).nullish(),
  numeric_delta: z.number().nullish(),
  rate_source_candidate: z.enum(['CONTRACT', 'AT_COST', 'DSV_HANDLING', 'UNKNOWN']).nullish(),
  for_charge_component: z.string().nullish(),
  type_b: z.string().nullish(),
  // Rate validation taxonomy — see rate_match_logic.md §3/§11
  rate_type: RateTypeSchema.nullish(),
  ai_rate_status: AiRateStatusSchema.nullish(),
  match_eligible: z.enum(['Y', 'N']).nullish(),
  contract_row_id: z.string().nullish(),
  effective_from: z.string().nullish(),
  effective_to: z.string().nullish(),
  variance_amount: z.number().nullish(),
  evidence_status: EvidenceStatusSchema.nullish(),
  rate_status: z.enum(['MATCHED', 'UNKNOWN', 'MISMATCH', 'NOT_APPLICABLE']).nullish(),
  validity_status: z.enum(['VALID', 'EXPIRED', 'PENDING']).nullish(),
  gate_status: VerdictSchema.nullish(),
  band: z.enum(['PASS', 'WARN', 'HIGH', 'CRITICAL']).nullish(),
  delta_pct: z.number().nullish(),
  // Risk + Action outputs — see rate_match_logic.md §9
  risk: RiskSchema.nullish(),
  action: z.string().nullish(),
  source_ref: z.object({
    sheet: z.string().optional(),
    row: z.number().optional(),
    col: z.string().optional(),
    text_span: z.string().optional(),
    formula_text: z.string().optional()
  }).nullish()
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
