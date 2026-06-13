import { STORE } from './job-store';
import type { FxPolicy } from './types';

export interface FxCheckResult {
  allowed: boolean;
  fx_policy_id?: string;
  fx_rate?: number;
  converted_amount?: number;
  error_code?: 'FX_POLICY_REQUIRED' | 'FX_POLICY_VALIDATION_FAILED';
  error_message?: string;
}

/**
 * Checks and converts currency if needed.
 * If invoiceCurrency and rateCurrency differ, we look up a valid FxPolicy.
 */
export async function checkAndConvertCurrency(
  invoiceCurrency: string,
  rateCurrency: string,
  amount: number,
  rateDateStr?: string
): Promise<FxCheckResult> {
  if (invoiceCurrency === rateCurrency) {
    return { allowed: true, converted_amount: amount };
  }

  const policies = await STORE.listFxPolicies();
  const targetDate = rateDateStr ? new Date(rateDateStr) : new Date();

  const matchingPolicy = policies.find(p => {
    if (p.from_currency !== invoiceCurrency || p.to_currency !== rateCurrency) {
      return false;
    }
    const validFrom = new Date(p.valid_from);
    const validTo = new Date(p.valid_to);
    return targetDate >= validFrom && targetDate <= validTo;
  });

  if (!matchingPolicy) {
    return {
      allowed: false,
      error_code: 'FX_POLICY_REQUIRED',
      error_message: `No active FX policy found from ${invoiceCurrency} to ${rateCurrency}`
    };
  }

  const policyRateDate = new Date(matchingPolicy.rate_date);
  const pValidFrom = new Date(matchingPolicy.valid_from);
  const pValidTo = new Date(matchingPolicy.valid_to);
  if (policyRateDate < pValidFrom || policyRateDate > pValidTo) {
    return {
      allowed: false,
      error_code: 'FX_POLICY_VALIDATION_FAILED',
      error_message: `FX Policy ${matchingPolicy.fx_policy_id} is invalid: rate_date is outside validity period`
    };
  }

  const converted = parseFloat((amount * matchingPolicy.fx_rate).toFixed(4));
  return {
    allowed: true,
    fx_policy_id: matchingPolicy.fx_policy_id,
    fx_rate: matchingPolicy.fx_rate,
    converted_amount: converted
  };
}
