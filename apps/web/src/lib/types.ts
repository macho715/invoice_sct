import { z } from 'zod';

export { InvoiceLineSchema, NormalizedInvoiceSchema, EvidenceCandidateSchema } from '@invoice-audit/contracts/invoice';
export type { InvoiceLine, NormalizedInvoice, EvidenceCandidate } from '@invoice-audit/contracts/invoice';

export const JobStatusSchema = z.enum([
  'CREATED','UPLOADING','UPLOADED','QUEUED','PARSING','VALIDATING',
  'REVIEW_REQUIRED','APPROVED','EXPORTING','COMPLETED','FAILED','REJECTED'
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const VerdictSchema = z.enum(['PASS','AMBER','ZERO','FAILED']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const SourceFileSchema = z.object({
  file_id: z.string().min(1),
  job_id: z.string().min(1),
  original_filename: z.string().min(1),
  file_type: z.enum(['xlsx','md','txt','pdf','image','unknown']),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  blob_ref: z.string().min(1),
  blob_url: z.string().nullish(),
  parser_status: z.enum(['PENDING','PARSED','FAILED','SKIPPED']),
  uploaded_by: z.string().min(1),
  uploaded_at: z.string().datetime()
});
export type SourceFile = z.infer<typeof SourceFileSchema>;


export const SctValidationResultSchema = z.object({
  validation_id: z.string(),
  job_id: z.string(),
  sct_trace_id: z.string(),
  cf_mcp_tool_calls: z.array(z.object({
    tool: z.string(),
    latency_ms: z.number(),
    status: z.enum(['OK','ERROR','TIMEOUT']),
    request_ref: z.string().nullish(),
    response_ref: z.string().nullish()
  })),
  type_b_results: z.array(z.object({ line_id: z.string(), type_b: z.string(), confidence: z.number() })),
  hs_uae_results: z.array(z.object({ line_id: z.string(), verdict: VerdictSchema, boe_found: z.boolean(), reason_code: z.string().nullish() })),
  rate_checks: z.array(z.object({ line_id: z.string(), rate_status: z.string(), validity_status: z.enum(['VALID','EXPIRED','PENDING']).nullish() })),
  evidence_requirements: z.array(z.object({ line_id: z.string(), required_evidence: z.array(z.string()) })),
  costguard_results: z.array(z.object({
    line_id: z.string(), band: z.enum(['PASS','WARN','HIGH','CRITICAL']),
    verdict: z.string(), delta_pct: z.number().nullish(), prism_kernel_proof_ref: z.string().nullish()
  })),
  doc_guardian_results: z.array(z.object({ line_id: z.string().nullish(), code: z.string(), severity: z.enum(['AMBER','ZERO']) })),
  gate_results: z.array(z.object({ line_id: z.string().nullish(), gate_status: VerdictSchema, reason_codes: z.array(z.string()) })),
  normalized_lines: z.array(z.object({ line_id: z.string(), charge_code: z.string().nullish(), unit: z.string().nullish() })).optional(),
  confidence: z.number().min(0).max(1),
  reason_codes: z.array(z.string()),
  warnings: z.array(z.string())
});
export type SctValidationResult = z.infer<typeof SctValidationResultSchema>;

export const GateResultSchema = z.object({
  gate_id: z.string(),
  job_id: z.string(),
  verdict: VerdictSchema,
  line_results: z.array(z.object({
    line_id: z.string(),
    verdict: VerdictSchema,
    band: z.enum(['PASS','WARN','HIGH','CRITICAL']).nullish(),
    delta_pct: z.number().nullish(),
    reason_codes: z.array(z.string())
  })),
  action_items: z.array(z.object({
    action_id: z.string(), severity: VerdictSchema, line_id: z.string().nullish(),
    issue_type: z.string(), required_action: z.string()
  }))
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const AuditTraceStepSchema = z.enum([
  'UPLOAD','PARSE','SOURCE_DATA','VALIDATE','COSTGUARD','MOSB_GATE','DOC_GUARDIAN','DECISION','APPROVAL','EXPORT','AMBER_OVERRIDE','EVIDENCE_PARSE','NOTEBOOKLM','VISION_FALLBACK'
]);
export type AuditTraceStep = z.infer<typeof AuditTraceStepSchema>;

export const AuditTraceEntrySchema = z.object({
  trace_id: z.string(),
  job_id: z.string(),
  step: AuditTraceStepSchema,
  input_ref: z.string(),
  output_ref: z.string(),
  timestamp: z.string().datetime(),
  rule_version: z.string().nullish(),
  source_hash: z.string().nullish(),
  calculation_hash: z.string().nullish(),
  latency_ms: z.number().nullish(),
  wasDerivedFrom: z.string().nullish(),
  attributedTo: z.string().nullish(),
  notebooklm_source_id: z.string().nullish(),
  notebooklm_summary_received_at: z.string().datetime().nullish(),
  notebooklm_confidence: z.number().min(0).max(1).nullish(),
  notebooklm_flags: z.array(z.string()).nullish(),
  dual_extraction_mismatches: z.array(z.object({
    field: z.string(),
    parser_value_hash: z.string().nullish(),
    notebooklm_value_hash: z.string().nullish(),
    impact: z.enum(['HIGH', 'LOW'])
  })).nullish()
});
export type AuditTraceEntry = z.infer<typeof AuditTraceEntrySchema>;

export const HumanGateTriggerSchema = z.object({
  trigger_id: z.string(),
  name: z.string(),
  severity: z.enum(['ZERO', 'AMBER']),
  status: z.enum(['PENDING', 'RESOLVED']),
  required_role: z.string(),
  resolved_by: z.string().nullable(),
  resolved_at: z.string().nullable()
});
export type HumanGateTrigger = z.infer<typeof HumanGateTriggerSchema>;

export const ApprovalRecordSchema = z.object({
  approval_id: z.string(),
  job_id: z.string(),
  status: z.literal('APPROVED'),
  approved_by: z.string(),
  approved_at: z.string(),
  approval_scope: z.enum(['AMBER_ACK', 'ZERO_APPROVED']),
  acknowledgement_reason: z.string().nullable(),
  prism_kernel_proof_ref: z.string(),
  triggers: z.array(HumanGateTriggerSchema)
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const DecisionRowSchema = z.object({
  job_id: z.string(),
  verdict: z.string(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  rule_version: z.string(),
  parser_version: z.string(),
  final_recon_status: z.string().nullable(),
  zero_count: z.number(),
  amber_count: z.number(),
  prism_kernel_proof_ref: z.string().nullable(),
  costguard_band_summary: z.string().nullable(),
  watermark: z.string().nullable(),
  generated_at: z.string().nullable()
});
export type DecisionRow = z.infer<typeof DecisionRowSchema>;

export const ActionItemRowSchema = z.object({
  action_id: z.string(),
  severity: z.string(),
  shipment_ref: z.string().nullable(),
  line_id: z.string().nullable(),
  issue_type: z.string(),
  required_action: z.string(),
  owner_role: z.string().nullable(),
  status: z.string().nullable(),
  prism_kernel_proof_ref: z.string().nullable()
});
export type ActionItemRow = z.infer<typeof ActionItemRowSchema>;

export const FinalReconRowSchema = z.object({
  currency: z.string(),
  shipment_ref: z.string().nullable(),
  invoice_total: z.number(),
  reviewed_total: z.number(),
  variance: z.number(),
  variance_pct: z.number(),
  recon_status: z.string(),
  evidence_ref: z.string().nullable()
});
export type FinalReconRow = z.infer<typeof FinalReconRowSchema>;

export const LineViewRowSchema = z.object({
  line_id: z.string(),
  shipment_ref: z.string().nullable(),
  description: z.string(),
  for_charge_component: z.string().nullable(),
  type_b: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  rate_source: z.string().nullable(),
  rate_status: z.string().nullable(),
  validity_status: z.string().nullable(),
  evidence_status: z.string().nullable(),
  gate_status: z.string().nullable(),
  band: z.string().nullable(),
  delta_pct: z.number().nullable(),
  numeric_integrity_status: z.string().nullable(),
  difference: z.number().nullable()
});
export type LineViewRow = z.infer<typeof LineViewRowSchema>;

export const SourceDataRowSchema = z.object({
  file_id: z.string(),
  source_ref: z.string().nullable(),
  original_text: z.string().nullable(),
  normalized_value: z.string().nullable(),
  confidence: z.number().nullable(),
  routing_pattern: z.string().nullable(),
  pdf_page: z.number().nullable().optional(),
  text_span_hash: z.string().nullable().optional(),
  doc_type: z.string().nullable().optional(),
  shipment_id: z.string().nullable().optional(),
  gate_score: z.number().nullable().optional(),
  gate_status: z.string().nullable().optional(),
  is_portal_fee: z.boolean().nullable().optional()
});
export type SourceDataRow = z.infer<typeof SourceDataRowSchema>;

export const AuditDetailRowSchema = z.object({
  line_id: z.string(),
  rule_id: z.string(),
  reason_code: z.string(),
  sct_trace_id: z.string(),
  cf_mcp_tool: z.string().nullable(),
  cf_mcp_latency_ms: z.number().nullable(),
  confidence: z.number().nullable(),
  decision_input: z.string().nullable(),
  fx_override: z.string().nullable(),
  fx_policy_id: z.string().nullable()
});
export type AuditDetailRow = z.infer<typeof AuditDetailRowSchema>;

export const EvidenceIssuesRowSchema = z.object({
  line_id: z.string(),
  required_evidence: z.string().nullable(),
  matched_evidence: z.string().nullable(),
  gap_type: z.string().nullable(),
  severity: z.string(),
  action_item_id: z.string().nullable(),
  human_gate_trigger_id: z.string().nullable()
});
export type EvidenceIssuesRow = z.infer<typeof EvidenceIssuesRowSchema>;

export const HeaderCheckRowSchema = z.object({
  field_name: z.string(),
  expected_value: z.string().nullable(),
  actual_value: z.string().nullable(),
  match_status: z.string(),
  severity: z.string().nullable()
});
export type HeaderCheckRow = z.infer<typeof HeaderCheckRowSchema>;

export const DuplicateCheckRowSchema = z.object({
  invoice_no_hash: z.string(),
  vendor_hash: z.string(),
  amount_hash: z.string().nullable(),
  issue_date_hash: z.string().nullable(),
  match_type: z.string(),
  severity: z.string(),
  matched_job_id: z.string().nullable()
});
export type DuplicateCheckRow = z.infer<typeof DuplicateCheckRowSchema>;

export const RateCheckRowSchema = z.object({
  line_id: z.string(),
  charge_code: z.string().nullable(),
  lane: z.string().nullable(),
  contract_rate: z.number().nullable(),
  invoiced_rate: z.number().nullable(),
  rate_basis: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  rate_status: z.string(),
  delta_pct: z.number().nullable(),
  severity: z.string()
});
export type RateCheckRow = z.infer<typeof RateCheckRowSchema>;

export const TaxFxCheckRowSchema = z.object({
  line_id: z.string(),
  currency: z.string(),
  vat_rate: z.number().nullable(),
  vat_amount: z.number().nullable(),
  fx_rate_applied: z.number().nullable(),
  fx_policy_id: z.string().nullable(),
  tax_status: z.string(),
  fx_status: z.string(),
  severity: z.string()
});
export type TaxFxCheckRow = z.infer<typeof TaxFxCheckRowSchema>;

export const ShipmentMatchRowSchema = z.object({
  line_id: z.string(),
  shipment_ref: z.string().nullable(),
  job_number: z.string().nullable(),
  bl_number: z.string().nullable(),
  do_number: z.string().nullable(),
  po_number: z.string().nullable(),
  match_status: z.string(),
  matched_fields: z.string().nullable(),
  severity: z.string()
});
export type ShipmentMatchRow = z.infer<typeof ShipmentMatchRowSchema>;

export const ManifestEntrySchema = z.object({
  key: z.string(),
  value: z.string()
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ExportRequestSchema = z.object({
  job_id: z.string(),
  decision_rows: z.array(DecisionRowSchema),
  action_items_rows: z.array(ActionItemRowSchema),
  final_recon_rows: z.array(FinalReconRowSchema),
  header_check_rows: z.array(HeaderCheckRowSchema).default([]),
  line_view_rows: z.array(LineViewRowSchema),
  duplicate_check_rows: z.array(DuplicateCheckRowSchema).default([]),
  rate_check_rows: z.array(RateCheckRowSchema).default([]),
  tax_fx_check_rows: z.array(TaxFxCheckRowSchema).default([]),
  shipment_match_rows: z.array(ShipmentMatchRowSchema).default([]),
  source_data_rows: z.array(SourceDataRowSchema),
  audit_detail_rows: z.array(AuditDetailRowSchema),
  evidence_issues_rows: z.array(EvidenceIssuesRowSchema),
  manifest_entries: z.array(ManifestEntrySchema).default([]),
  generated_at: z.string().optional()
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export const SheetManifestSchema = z.object({
  sheet_name: z.string(),
  row_count: z.number()
});
export type SheetManifest = z.infer<typeof SheetManifestSchema>;

export const WorkbookManifestSchema = z.object({
  sha256: z.string(),
  size_bytes: z.number(),
  sheets: z.array(SheetManifestSchema),
  generated_at: z.string()
});
export type WorkbookManifest = z.infer<typeof WorkbookManifestSchema>;

export const FxPolicySchema = z.object({
  fx_policy_id: z.string(),
  from_currency: z.string(),
  to_currency: z.string(),
  fx_rate: z.number(),
  rate_date: z.string(),
  valid_from: z.string(),
  valid_to: z.string(),
  approved_by: z.string(),
  proof_hash: z.string()
});
export type FxPolicy = z.infer<typeof FxPolicySchema>;
export type FxPolicyId = string;
