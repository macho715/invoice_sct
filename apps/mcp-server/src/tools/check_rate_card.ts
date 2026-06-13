import { z } from 'zod';
import { getPool } from '../db.js';

export const ToolName = 'check_rate_card' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckRateCardInputSchema = z.object({
  charge_code: z.string(),
  lane: z.string().nullable(),
  rate_basis: z.string().nullable(),
  effective_date: z.string().nullable(),
  applied_rate: z.number().nullable()
});

export const CheckRateCardOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  contracted_rate: z.number().nullable(),
  applied_rate: z.number().nullable(),
  variance_pct: z.number().nullable(),
  reason_code: z.string().nullable()
});

export type CheckRateCardInput = z.infer<typeof CheckRateCardInputSchema>;
export type CheckRateCardOutput = z.infer<typeof CheckRateCardOutputSchema>;

export async function run(input: CheckRateCardInput): Promise<CheckRateCardOutput> {
  let contractedRate: number | null = null;

  try {
    const pool = getPool();
    const params: (string | null)[] = [input.charge_code];
    let sql = `SELECT contracted_rate FROM rate_cards WHERE charge_code = $1`;

    if (input.lane) {
      sql += ` AND lane = $2`;
      params.push(input.lane);
    }

    sql += ` LIMIT 1`;

    const result = await pool.query<{ contracted_rate: string | number }>(sql, params);

    if (result.rows.length > 0) {
      contractedRate =
        typeof result.rows[0].contracted_rate === 'string'
          ? Number(result.rows[0].contracted_rate)
          : result.rows[0].contracted_rate;
    }
  } catch {
    return {
      verdict: 'AMBER',
      contracted_rate: null,
      applied_rate: null,
      variance_pct: null,
      reason_code: 'RATE_NOT_FOUND',
    };
  }

  if (contractedRate === null) {
    return {
      verdict: 'AMBER',
      contracted_rate: null,
      applied_rate: null,
      variance_pct: null,
      reason_code: 'RATE_NOT_FOUND',
    };
  }

  const appliedRate: number | null = input.applied_rate;

  if (appliedRate === null) {
    return {
      verdict: 'AMBER',
      contracted_rate: contractedRate,
      applied_rate: null,
      variance_pct: null,
      reason_code: 'RATE_NOT_APPLIED',
    };
  }

  const variancePct =
    contractedRate !== 0
      ? ((appliedRate - contractedRate) / contractedRate) * 100
      : 0;

  const absVariance = Math.abs(variancePct);

  if (absVariance <= 2) {
    return {
      verdict: 'PASS',
      contracted_rate: contractedRate,
      applied_rate: appliedRate,
      variance_pct: Math.round(variancePct * 100) / 100,
      reason_code: null,
    };
  }

  if (absVariance <= 5) {
    return {
      verdict: 'AMBER',
      contracted_rate: contractedRate,
      applied_rate: appliedRate,
      variance_pct: Math.round(variancePct * 100) / 100,
      reason_code: 'RATE_VARIANCE',
    };
  }

  return {
    verdict: 'ZERO',
    contracted_rate: contractedRate,
    applied_rate: appliedRate,
    variance_pct: Math.round(variancePct * 100) / 100,
    reason_code: 'RATE_EXCEEDS_THRESHOLD',
  };
}
