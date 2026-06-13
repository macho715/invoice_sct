import { z } from 'zod';

export const ToolName = 'check_fx_policy' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckFxPolicyInputSchema = z.object({
  from_currency: z.string(),
  to_currency: z.string(),
  amount: z.number(),
  rate_date: z.string().nullable()
});

export const CheckFxPolicyOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  applied_rate: z.number().nullable(),
  policy_rate: z.number().nullable(),
  variance_pct: z.number().nullable(),
  reason_code: z.string().nullable()
});

export type CheckFxPolicyInput = z.infer<typeof CheckFxPolicyInputSchema>;
export type CheckFxPolicyOutput = z.infer<typeof CheckFxPolicyOutputSchema>;

const AED_USD_PEG = 3.6725;

export async function run(input: CheckFxPolicyInput): Promise<CheckFxPolicyOutput> {
  const { from_currency, to_currency } = input;

  if (from_currency === to_currency) {
    return {
      verdict: 'PASS',
      applied_rate: 1.0,
      policy_rate: 1.0,
      variance_pct: 0,
      reason_code: null
    };
  }

  const isAedUsdPair =
    (from_currency === 'AED' && to_currency === 'USD') ||
    (from_currency === 'USD' && to_currency === 'AED');

  if (isAedUsdPair) {
    return {
      verdict: 'AMBER',
      applied_rate: null,
      policy_rate: AED_USD_PEG,
      variance_pct: null,
      reason_code: 'FX_RATE_UNVERIFIABLE'
    };
  }

  return {
    verdict: 'AMBER',
    applied_rate: null,
    policy_rate: null,
    variance_pct: null,
    reason_code: 'FX_RATE_UNVERIFIABLE'
  };
}
