import { z } from 'zod';
import { VerdictSchema } from './invoice.schema';

export const ValidationFindingSchema = z.object({
  finding_id: z.string(),
  rule_id: z.string(),
  line_id: z.string().nullable(),
  severity: VerdictSchema,
  reason_code: z.string(),
  message: z.string(),
  source_ref: z.string().nullable(),
  recommended_action: z.string().nullable()
});
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;

export const McpToolCallSchema = z.object({
  tool: z.string(),
  latency_ms: z.number(),
  status: z.enum(['OK', 'ERROR', 'TIMEOUT']),
  request_ref: z.string().nullable(),
  response_ref: z.string().nullable()
});
export type McpToolCall = z.infer<typeof McpToolCallSchema>;

export const MCP_TOOL_LIST = [
  'route_question',
  'normalize_invoice_lines',
  'check_duplicate_invoice',
  'match_shipment_reference',
  'check_rate_card',
  'check_contract_validity',
  'check_evidence_required',
  'check_tax_vat',
  'check_fx_policy',
  'check_cost_guard',
  'build_validation_explanation'
] as const;

export type McpToolName = typeof MCP_TOOL_LIST[number];

export function validateMcpToolList(actualTools: string[]): { valid: boolean; missing: string[]; extra: string[] } {
  const expected = new Set<string>(MCP_TOOL_LIST);
  const actual = new Set<string>(actualTools);
  const missing = [...expected].filter(t => !actual.has(t));
  const extra = [...actual].filter(t => !expected.has(t));
  return { valid: missing.length === 0 && extra.length === 0, missing, extra };
}
