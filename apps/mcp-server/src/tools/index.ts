/**
 * MCP Validation Server - 12 tools registry (Q-003 resolution).
 *
 * Each tool module exports:
 *   - ToolName: const literal string for the tool's identifier
 *   - TOOL_VERSION: semver string
 *   - {Tool}InputSchema / {Tool}OutputSchema: Zod schemas
 *   - run(input): implementation (stub by default)
 *
 * This index composes all 11 tools into MCP_TOOLS for Hono routing in main.ts.
 */
import type { z } from 'zod';

import * as route_question from '@invoice-audit/tools/route_question';
import * as normalize_invoice_lines from '@invoice-audit/tools/normalize_invoice_lines';
import * as check_duplicate_invoice from '@invoice-audit/tools/check_duplicate_invoice';
import * as match_shipment_reference from '@invoice-audit/tools/match_shipment_reference';
import * as check_rate_card from '@invoice-audit/tools/check_rate_card';
import * as check_contract_validity from '@invoice-audit/tools/check_contract_validity';
import * as check_evidence_required from '@invoice-audit/tools/check_evidence_required';
import * as check_tax_vat from '@invoice-audit/tools/check_tax_vat';
import * as check_fx_policy from '@invoice-audit/tools/check_fx_policy';
import * as check_cost_guard from '@invoice-audit/tools/check_cost_guard';
import * as check_hs_uae_compliance from '@invoice-audit/tools/check_hs_uae_compliance';
import * as build_validation_explanation from '@invoice-audit/tools/build_validation_explanation';
import * as classify_type_b from '@invoice-audit/tools/classify_type_b';
import * as check_dem_det from '@invoice-audit/tools/check_dem_det';

export {
  check_dem_det,
  route_question,
  normalize_invoice_lines,
  check_duplicate_invoice,
  match_shipment_reference,
  check_rate_card,
  check_contract_validity,
  check_evidence_required,
  check_tax_vat,
  check_fx_policy,
  check_cost_guard,
  check_hs_uae_compliance,
  build_validation_explanation,
  classify_type_b
};

// Per-module shape is intentionally loose so each tool file can keep its precise
// input/output types internally; consumers should rely on ToolInputSchemas for strict types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpToolModule = any;

export const ALL_TOOLS: McpToolModule[] = [
  check_dem_det,
  route_question,
  normalize_invoice_lines,
  check_duplicate_invoice,
  match_shipment_reference,
  check_rate_card,
  check_contract_validity,
  check_evidence_required,
  check_tax_vat,
  check_fx_policy,
  check_cost_guard,
  check_hs_uae_compliance,
  build_validation_explanation,
  classify_type_b
];

if (ALL_TOOLS.length !== 14) {
  throw new Error(`Expected 14 tools, got ${ALL_TOOLS.length}`);
}

// Loose schema typing so MCP_TOOLS can be uniformly listed for /tools/list and
// main.ts can still call .shape on ZodObject members at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodSchema = z.ZodType<any, any, any>;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: AnyZodSchema;
  version: string;
  module: McpToolModule;
}

const DESCRIPTIONS: Record<string, string> = {
  route_question: 'Routes validation questions to the appropriate handler',
  normalize_invoice_lines: 'Normalizes invoice line items into a standard format',
  check_duplicate_invoice: 'Detects duplicate invoices (vendor + number + amount + date)',
  match_shipment_reference: 'Matches shipment / job / BL / DO references across documents',
  check_rate_card: 'Validates charges against contract rate cards',
  check_contract_validity: 'Checks whether a vendor contract is valid for a given date',
  check_evidence_required: 'Determines required evidence for a charge line',
  check_tax_vat: 'Validates VAT / tax compliance',
  check_fx_policy: 'Validates foreign exchange rate usage against policy',
  check_cost_guard: 'Runs CostGuard numeric-integrity + standard-rate analysis',
  check_hs_uae_compliance: 'Validates HS/UAE customs compliance (BOE + HS code)',
  build_validation_explanation: 'Generates human-readable explanation for a validation finding',
  classify_type_b: 'Classifies an invoice line into a TYPE-B category (INSPECTION/CUSTOMS/DO/INLAND/THC/DETENTION/STROAGE/OTHERS)',
  check_dem_det: 'Checks DEM/DET (demurrage/detention/storage) charge inputs for dates, tariff, free time, invoice, settlement status'
};

// Build the unified schema map (preserves the legacy ToolInputSchemas contract).
export const ToolInputSchemas = {
  route_question: route_question.RouteQuestionInputSchema,
  normalize_invoice_lines: normalize_invoice_lines.NormalizeInvoiceLinesInputSchema,
  check_duplicate_invoice: check_duplicate_invoice.CheckDuplicateInvoiceInputSchema,
  match_shipment_reference: match_shipment_reference.MatchShipmentReferenceInputSchema,
  check_rate_card: check_rate_card.CheckRateCardInputSchema,
  check_contract_validity: check_contract_validity.CheckContractValidityInputSchema,
  check_evidence_required: check_evidence_required.CheckEvidenceRequiredInputSchema,
  check_tax_vat: check_tax_vat.CheckTaxVatInputSchema,
  check_fx_policy: check_fx_policy.CheckFxPolicyInputSchema,
  check_cost_guard: check_cost_guard.CheckCostGuardInputSchema,
  check_hs_uae_compliance: check_hs_uae_compliance.CheckHsUaeComplianceInputSchema,
  build_validation_explanation: build_validation_explanation.BuildValidationExplanationInputSchema,
  classify_type_b: classify_type_b.ClassifyTypeBInputSchema,
  check_dem_det: check_dem_det.CheckDemDetInputSchema
} as const;

export const MCP_TOOL_LIST = Object.keys(ToolInputSchemas) as Array<keyof typeof ToolInputSchemas>;

export type McpToolName = keyof typeof ToolInputSchemas;

export const MCP_TOOLS: McpToolDefinition[] = ALL_TOOLS.map((m) => {
  const name = m.ToolName as McpToolName;
  return {
    name,
    description: DESCRIPTIONS[name] ?? '',
    inputSchema: ToolInputSchemas[name] as unknown as AnyZodSchema,
    version: m.TOOL_VERSION,
    module: m
  };
});

