import { z } from 'zod';

export const ToolName = 'build_validation_explanation' as const;
export const TOOL_VERSION = '0.2.0';

export const BuildValidationExplanationInputSchema = z.object({
  finding_id: z.string(),
  rule_id: z.string(),
  reason_code: z.string(),
  line_id: z.string().nullable(),
  severity: z.enum(['PASS', 'AMBER', 'ZERO'])
});

export const BuildValidationExplanationOutputSchema = z.object({
  explanation: z.string(),
  recommended_action: z.string(),
  reviewer_hint: z.string().nullable()
});

export type BuildValidationExplanationInput = z.infer<typeof BuildValidationExplanationInputSchema>;
export type BuildValidationExplanationOutput = z.infer<typeof BuildValidationExplanationOutputSchema>;

const EXPLANATION_TEMPLATES: Record<string, string> = {
  DUPLICATE_INVOICE:
    'This invoice appears to be a duplicate. A previous invoice with the same vendor and invoice number was found with a matching amount.',
  AMOUNT_MISMATCH:
    'A previous invoice with the same vendor and invoice number was found but with a different amount. This may indicate a corrected re-issue.',
  RATE_VARIANCE:
    'The applied rate differs from the contracted rate by more than the allowed threshold.',
  RATE_NOT_FOUND:
    'No contracted rate was found for this charge code and lane combination.',
  CONTRACT_EXPIRED:
    'The vendor contract was expired at the time of this transaction.',
  CONTRACT_NOT_FOUND:
    'No active contract was found for this vendor.',
  VAT_RATE_MISMATCH:
    'The VAT amount calculated does not match the expected 5% UAE VAT.',
  EVIDENCE_MISSING:
    'Required supporting documents are missing for this charge line.',
  QTY_X_RATE_MISMATCH:
    'The product of quantity and rate does not match the declared line amount.',
  COST_VARIANCE_EXCEEDS_2PCT:
    'The cost variance exceeds the 2% threshold defined in the Cost Guard policy.'
};

const ACTION_MAP: Record<string, string> = {
  ZERO: 'Review required. This item cannot be approved without resolution.',
  AMBER: 'Reviewer attention needed. Verify and approve or escalate.',
  PASS: 'No action required.'
};

const HINT_MAP: Record<string, string | null> = {
  ZERO: 'Escalate to Contract/Admin for resolution.',
  AMBER: 'Ops Lead or Finance Manager may approve if variance is justified.',
  PASS: null
};

export async function run(
  input: BuildValidationExplanationInput
): Promise<BuildValidationExplanationOutput> {
  const explanation =
    EXPLANATION_TEMPLATES[input.reason_code] ??
    `Validation finding for rule ${input.rule_id} on line ${input.line_id}.`;

  return {
    explanation,
    recommended_action: ACTION_MAP[input.severity],
    reviewer_hint: HINT_MAP[input.severity]
  };
}
