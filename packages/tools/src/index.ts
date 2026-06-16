import { route_question, RouteQuestionInputSchema } from './route_question.js';
import { classify_type_b, ClassifyTypeBInputSchema } from './classify_type_b.js';
import { check_cost_guard, CheckCostGuardInputSchema } from './check_cost_guard.js';
import { check_evidence_required, CheckEvidenceRequiredInputSchema } from './check_evidence_required.js';
import { check_hs_uae_compliance, CheckHsUaeComplianceInputSchema } from './check_hs_uae_compliance.js';
import { check_rate_card, CheckRateCardInputSchema } from './check_rate_card.js';
import { normalize_invoice_lines, NormalizeInvoiceLinesInputSchema } from './normalize_invoice_lines.js';
import { check_duplicate_invoice, CheckDuplicateInvoiceInputSchema } from './check_duplicate_invoice.js';
import { match_shipment_reference, MatchShipmentReferenceInputSchema } from './match_shipment_reference.js';
import { check_contract_validity, CheckContractValidityInputSchema } from './check_contract_validity.js';
import { check_tax_vat, CheckTaxVatInputSchema } from './check_tax_vat.js';
import { check_fx_policy, CheckFxPolicyInputSchema } from './check_fx_policy.js';
import { build_validation_explanation, BuildValidationExplanationInputSchema } from './build_validation_explanation.js';
import { check_dem_det, CheckDemDetInputSchema } from './check_dem_det.js';
import { domestic_lane_check, DomesticLaneCheckInputSchema } from './domestic_lane_check.js';
import type { ToolEntry } from './types.js';

export { route_question, RouteQuestionInputSchema } from './route_question.js';
export type { RouteQuestionInput, RouteQuestionOutput } from './route_question.js';

export { classify_type_b, ClassifyTypeBInputSchema } from './classify_type_b.js';
export type { ClassifyTypeBInput, ClassifyTypeBOutput, TypeBCategory } from './classify_type_b.js';

export { check_cost_guard, CheckCostGuardInputSchema } from './check_cost_guard.js';
export type { CheckCostGuardInput, CheckCostGuardOutput, LineFinding } from './check_cost_guard.js';

export { check_evidence_required, CheckEvidenceRequiredInputSchema } from './check_evidence_required.js';
export type { CheckEvidenceRequiredInput, CheckEvidenceRequiredOutput } from './check_evidence_required.js';

export { check_hs_uae_compliance, CheckHsUaeComplianceInputSchema } from './check_hs_uae_compliance.js';
export type { CheckHsUaeComplianceInput, CheckHsUaeComplianceOutput } from './check_hs_uae_compliance.js';

export { check_rate_card, check_rate_card_batch, run_batch, CheckRateCardInputSchema } from './check_rate_card.js';
export type { CheckRateCardInput, CheckRateCardOutput, RateCardBatchEntry } from './check_rate_card.js';

export { normalize_invoice_lines, NormalizeInvoiceLinesInputSchema } from './normalize_invoice_lines.js';
export type { NormalizeInvoiceLinesInput, NormalizeInvoiceLinesOutput, NormalizedLine } from './normalize_invoice_lines.js';

export { check_duplicate_invoice, CheckDuplicateInvoiceInputSchema } from './check_duplicate_invoice.js';
export type { CheckDuplicateInvoiceInput, CheckDuplicateInvoiceOutput, DuplicateRecord } from './check_duplicate_invoice.js';

export { match_shipment_reference, MatchShipmentReferenceInputSchema } from './match_shipment_reference.js';
export type { MatchShipmentReferenceInput, MatchShipmentReferenceOutput, ShipmentMatch } from './match_shipment_reference.js';

export { check_contract_validity, CheckContractValidityInputSchema } from './check_contract_validity.js';
export type { CheckContractValidityInput, CheckContractValidityOutput } from './check_contract_validity.js';

export { check_tax_vat, CheckTaxVatInputSchema } from './check_tax_vat.js';
export type { CheckTaxVatInput, CheckTaxVatOutput } from './check_tax_vat.js';

export { check_fx_policy, CheckFxPolicyInputSchema } from './check_fx_policy.js';
export type { CheckFxPolicyInput, CheckFxPolicyOutput } from './check_fx_policy.js';

export { build_validation_explanation, BuildValidationExplanationInputSchema } from './build_validation_explanation.js';
export type { BuildValidationExplanationInput, BuildValidationExplanationOutput } from './build_validation_explanation.js';

export { check_dem_det, CheckDemDetInputSchema } from './check_dem_det.js';
export type { CheckDemDetInput, CheckDemDetOutput } from './check_dem_det.js';

export { domestic_lane_check, DomesticLaneCheckInputSchema } from './domestic_lane_check.js';
export type { DomesticLaneCheckInput, DomesticLaneCheckOutput, DomesticLaneLineResult } from './domestic_lane_check.js';

export type { MCP_Verdict, ToolResult, ToolError } from './types.js';

const TOOLS: Record<string, ToolEntry> = {
  route_question: { input: RouteQuestionInputSchema, run: (a) => route_question(a as never) },
  classify_type_b: { input: ClassifyTypeBInputSchema, run: (a) => classify_type_b(a as never) },
  check_cost_guard: { input: CheckCostGuardInputSchema, run: (a) => check_cost_guard(a as never) },
  check_evidence_required: { input: CheckEvidenceRequiredInputSchema, run: (a) => check_evidence_required(a as never) },
  check_hs_uae_compliance: { input: CheckHsUaeComplianceInputSchema, run: (a) => check_hs_uae_compliance(a as never) },
  check_rate_card: { input: CheckRateCardInputSchema, run: (a) => check_rate_card(a as never) },
  normalize_invoice_lines: { input: NormalizeInvoiceLinesInputSchema, run: (a) => normalize_invoice_lines(a as never) },
  check_duplicate_invoice: { input: CheckDuplicateInvoiceInputSchema, run: (a) => check_duplicate_invoice(a as never) },
  match_shipment_reference: { input: MatchShipmentReferenceInputSchema, run: (a) => match_shipment_reference(a as never) },
  check_contract_validity: { input: CheckContractValidityInputSchema, run: (a) => check_contract_validity(a as never) },
  check_tax_vat: { input: CheckTaxVatInputSchema, run: (a) => check_tax_vat(a as never) },
  check_fx_policy: { input: CheckFxPolicyInputSchema, run: (a) => check_fx_policy(a as never) },
  build_validation_explanation: { input: BuildValidationExplanationInputSchema, run: (a) => build_validation_explanation(a as never) },
  check_dem_det: { input: CheckDemDetInputSchema, run: (a) => check_dem_det(a as never) },
  domestic_lane_check: { input: DomesticLaneCheckInputSchema, run: (a) => domestic_lane_check(a as never) }
};

export async function dispatch<T = unknown>(name: string, args: unknown): Promise<T> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid params for ${name}: ${parsed.error.message}`);
  }
  return (await tool.run(parsed.data)) as T;
}

export const MCP_TOOL_NAMES = Object.keys(TOOLS);
