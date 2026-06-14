import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_tax_vat' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckTaxVatInputSchema = z.object({
  line_id: z.string(),
  amount: z.number(),
  currency: z.enum(['AED', 'USD']),
  vat_rate: z.number().nullable()
});

export const CheckTaxVatOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  expected_vat: z.number().nullable(),
  applied_vat: z.number().nullable(),
  reason_code: z.string().nullable()
});

export type CheckTaxVatInput = z.infer<typeof CheckTaxVatInputSchema>;
export type CheckTaxVatOutput = z.infer<typeof CheckTaxVatOutputSchema>;

const UAE_VAT_RATE = 0.05;
const VAT_EPSILON = 0.01;

export async function check_tax_vat(input: CheckTaxVatInput): Promise<CheckTaxVatOutput> {
  const { amount, currency, vat_rate } = input;
  const expected_vat = amount * UAE_VAT_RATE;

  if (vat_rate === null) {
    return {
      verdict: 'AMBER',
      expected_vat,
      applied_vat: null,
      reason_code: 'VAT_RATE_NOT_SPECIFIED'
    };
  }

  const applied_vat = amount * vat_rate;

  if (vat_rate === UAE_VAT_RATE) {
    const reason_code = currency === 'USD' ? 'FX_VAT_CHECK_REQUIRED' : null;
    return {
      verdict: 'PASS',
      expected_vat,
      applied_vat,
      reason_code
    };
  }

  const diff = Math.abs(applied_vat - expected_vat);

  if (diff <= VAT_EPSILON) {
    return {
      verdict: 'AMBER',
      expected_vat,
      applied_vat,
      reason_code: 'VAT_ROUNDING'
    };
  }

  return {
    verdict: 'ZERO',
    expected_vat,
    applied_vat,
    reason_code: 'VAT_RATE_MISMATCH'
  };
}

export const run = check_tax_vat;
