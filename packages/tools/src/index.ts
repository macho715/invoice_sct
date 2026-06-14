import { route_question, RouteQuestionInputSchema } from './route_question.js';
import { classify_type_b, ClassifyTypeBInputSchema } from './classify_type_b.js';
import { check_cost_guard, CheckCostGuardInputSchema } from './check_cost_guard.js';
import { check_evidence_required, CheckEvidenceRequiredInputSchema } from './check_evidence_required.js';
import { check_hs_uae_compliance, CheckHsUaeComplianceInputSchema } from './check_hs_uae_compliance.js';
import { check_rate_card, CheckRateCardInputSchema } from './check_rate_card.js';
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

export { check_rate_card, CheckRateCardInputSchema } from './check_rate_card.js';
export type { CheckRateCardInput, CheckRateCardOutput } from './check_rate_card.js';

export type { MCP_Verdict, ToolResult, ToolError } from './types.js';

const TOOLS: Record<string, ToolEntry> = {
  route_question: { input: RouteQuestionInputSchema, run: (a) => route_question(a as never) },
  classify_type_b: { input: ClassifyTypeBInputSchema, run: (a) => classify_type_b(a as never) },
  check_cost_guard: { input: CheckCostGuardInputSchema, run: (a) => check_cost_guard(a as never) },
  check_evidence_required: { input: CheckEvidenceRequiredInputSchema, run: (a) => check_evidence_required(a as never) },
  check_hs_uae_compliance: { input: CheckHsUaeComplianceInputSchema, run: (a) => check_hs_uae_compliance(a as never) },
  check_rate_card: { input: CheckRateCardInputSchema, run: (a) => check_rate_card(a as never) }
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
