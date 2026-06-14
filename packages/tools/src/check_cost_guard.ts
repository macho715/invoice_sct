import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_cost_guard' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckCostGuardInputSchema = z.object({
  invoiceNo: z.string(),
  currency: z.enum(['AED', 'USD']),
  lines: z.array(
    z.object({
      lineNo: z.string(),
      item: z.string(),
      qty: z.number(),
      rate: z.number(),
      draftAmount: z.number(),
      standardAmount: z.number().nullable(),
      currency: z.enum(['AED', 'USD']),
      evidenceIds: z.array(z.string())
    })
  )
});

export type CheckCostGuardInput = z.infer<typeof CheckCostGuardInputSchema>;

export interface LineFinding {
  lineNo: string;
  qty_x_rate: number;
  draftAmount: number;
  standardAmount: number | null;
  variance_pct: number | null;
  reason_code: string | null;
}

export interface CheckCostGuardOutput {
  verdict: MCP_Verdict;
  line_findings: LineFinding[];
}

const AMOUNT_EPSILON = 0.01;
const VARIANCE_THRESHOLD = 2;

export async function check_cost_guard(input: CheckCostGuardInput): Promise<CheckCostGuardOutput> {
  const line_findings: LineFinding[] = input.lines.map((line) => {
    const qty_x_rate = line.qty * line.rate;
    if (Math.abs(qty_x_rate - line.draftAmount) > AMOUNT_EPSILON) {
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: 'QTY_X_RATE_MISMATCH' };
    }
    if (line.standardAmount !== null && line.standardAmount > 0) {
      const std_variance_pct = ((line.draftAmount - line.standardAmount) / line.standardAmount) * 100;
      if (Math.abs(std_variance_pct) > VARIANCE_THRESHOLD) {
        return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: Math.round(std_variance_pct * 100) / 100, reason_code: 'COST_VARIANCE_EXCEEDS_2PCT' };
      }
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: Math.round(std_variance_pct * 100) / 100, reason_code: null };
    }
    if (line.standardAmount === null) {
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: 'STANDARD_RATE_NOT_AVAILABLE' };
    }
    return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: null };
  });

  let verdict: MCP_Verdict = 'PASS';
  for (const finding of line_findings) {
    if (finding.reason_code === 'QTY_X_RATE_MISMATCH') { verdict = 'ZERO'; break; }
    if (finding.reason_code === 'COST_VARIANCE_EXCEEDS_2PCT' || finding.reason_code === 'STANDARD_RATE_NOT_AVAILABLE') { verdict = 'AMBER'; }
  }

  return { verdict, line_findings };
}

export const run = check_cost_guard;
