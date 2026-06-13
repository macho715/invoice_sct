/**
 * MCP Validation Server - 11 tools registry (Q-003 resolution).
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

import * as route_question from './route_question.js';
import * as normalize_invoice_lines from './normalize_invoice_lines.js';
import * as check_duplicate_invoice from './check_duplicate_invoice.js';
import * as match_shipment_reference from './match_shipment_reference.js';
import * as check_rate_card from './check_rate_card.js';
import * as check_contract_validity from './check_contract_validity.js';
import * as check_evidence_required from './check_evidence_required.js';
import * as check_tax_vat from './check_tax_vat.js';
import * as check_fx_policy from './check_fx_policy.js';
import * as check_cost_guard from './check_cost_guard.js';
import * as build_validation_explanation from './build_validation_explanation.js';

export {
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
  build_validation_explanation
};

// Per-module shape is intentionally loose so each tool file can keep its precise
// input/output types internally; consumers should rely on ToolInputSchemas for strict types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpToolModule = any;

export const ALL_TOOLS: McpToolModule[] = [
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
  build_validation_explanation
];

if (ALL_TOOLS.length !== 11) {
  throw new Error(`Expected 11 tools, got ${ALL_TOOLS.length}`);
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
  build_validation_explanation: 'Generates human-readable explanation for a validation finding'
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
  build_validation_explanation: build_validation_explanation.BuildValidationExplanationInputSchema
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
