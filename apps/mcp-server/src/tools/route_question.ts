import { z } from 'zod';

export const ToolName = 'route_question' as const;
export const TOOL_VERSION = '0.2.0';

export const RouteQuestionInputSchema = z.object({
  question: z.string(),
  userRole: z.string()
});

export const RouteQuestionOutputSchema = z.object({
  routed_to: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string()
});

export type RouteQuestionInput = z.infer<typeof RouteQuestionInputSchema>;
export type RouteQuestionOutput = z.infer<typeof RouteQuestionOutputSchema>;

const ROUTE_RULES: Array<{ keywords: string[]; routed_to: string; confidence: number }> = [
  { keywords: ['duplicate'], routed_to: 'check_duplicate_invoice', confidence: 0.9 },
  { keywords: ['rate', 'price', 'cost'], routed_to: 'check_rate_card', confidence: 0.85 },
  { keywords: ['contract', 'valid', 'expir'], routed_to: 'check_contract_validity', confidence: 0.85 },
  { keywords: ['evidence', 'document', 'proof'], routed_to: 'check_evidence_required', confidence: 0.85 },
  { keywords: ['vat', 'tax', 'trn'], routed_to: 'check_tax_vat', confidence: 0.9 },
  { keywords: ['fx', 'exchange', 'currency', 'convert'], routed_to: 'check_fx_policy', confidence: 0.85 },
  { keywords: ['shipment', 'bl', 'delivery', 'job'], routed_to: 'match_shipment_reference', confidence: 0.85 },
  { keywords: ['explain', 'reason', 'finding'], routed_to: 'build_validation_explanation', confidence: 0.8 },
];

export async function run(input: RouteQuestionInput): Promise<RouteQuestionOutput> {
  const q = input.question.toLowerCase();
  const roleLower = input.userRole.toLowerCase();
  const isFinanceOrApprover = roleLower.includes('finance') || roleLower.includes('approver');

  for (const rule of ROUTE_RULES) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      const confidence = Math.min(1.0, Math.round((rule.confidence + (isFinanceOrApprover ? 0.05 : 0)) * 100) / 100);
      return {
        routed_to: rule.routed_to,
        confidence,
        rationale: `Keyword match: "${rule.keywords.find((kw) => q.includes(kw))}" → ${rule.routed_to}`
      };
    }
  }

  const defaultConfidence = Math.min(1.0, Math.round((0.5 + (isFinanceOrApprover ? 0.05 : 0)) * 100) / 100);
  return {
    routed_to: 'check_cost_guard',
    confidence: defaultConfidence,
    rationale: 'Default route: cost guard analysis'
  };
}
