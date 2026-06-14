import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_dem_det' as const;
export const TOOL_VERSION = '0.1.0';

export const CheckDemDetInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  has_dates: z.boolean(),
  has_tariff: z.boolean(),
  has_free_time: z.boolean(),
  has_invoice: z.boolean(),
  is_final_settlement: z.boolean()
});

export const CheckDemDetOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  missing_inputs: z.array(z.string()),
  reason_code: z.string().nullable()
});

export type CheckDemDetInput = z.infer<typeof CheckDemDetInputSchema>;
export type CheckDemDetOutput = z.infer<typeof CheckDemDetOutputSchema>;

const DEM_DET_CODES = ['DEMURRAGE', 'DETENTION', 'STORAGE'];

const INPUT_LABELS: Record<string, string> = {
  has_dates: 'DATES',
  has_tariff: 'TARIFF',
  has_free_time: 'FREE_TIME',
  has_invoice: 'INVOICE'
};

export async function check_dem_det(input: CheckDemDetInput): Promise<CheckDemDetOutput> {
  if (!DEM_DET_CODES.includes(input.charge_code)) {
    return { verdict: 'PASS', missing_inputs: [], reason_code: null };
  }

  const missing_inputs: string[] = [];
  if (!input.has_dates) missing_inputs.push(INPUT_LABELS.has_dates);
  if (!input.has_tariff) missing_inputs.push(INPUT_LABELS.has_tariff);
  if (!input.has_free_time) missing_inputs.push(INPUT_LABELS.has_free_time);
  if (!input.has_invoice) missing_inputs.push(INPUT_LABELS.has_invoice);

  if (missing_inputs.length === 0) {
    return { verdict: 'PASS', missing_inputs: [], reason_code: null };
  }

  if (input.is_final_settlement) {
    return { verdict: 'ZERO', missing_inputs, reason_code: 'DEMDET_FINAL_MISSING_INPUTS' };
  }

  return { verdict: 'AMBER', missing_inputs, reason_code: 'DEMDET_PARTIAL_INPUTS' };
}

export const run = check_dem_det;
