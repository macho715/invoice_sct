import { z } from 'zod';
import { getPool } from '@invoice-audit/database';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_rate_card' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckRateCardInputSchema = z.object({
  charge_code: z.string(),
  lane: z.string().nullable(),
  rate_basis: z.string().nullable(),
  effective_date: z.string().nullable(),
  applied_rate: z.number().nullable()
});

export type CheckRateCardInput = z.infer<typeof CheckRateCardInputSchema>;

export interface CheckRateCardOutput {
  verdict: MCP_Verdict;
  contracted_rate: number | null;
  applied_rate: number | null;
  variance_pct: number | null;
  reason_code: string | null;
}

export async function check_rate_card(input: CheckRateCardInput): Promise<CheckRateCardOutput> {
  let contractedRate: number | null = null;
  try {
    const pool = getPool();
    const params: (string | null)[] = [input.charge_code];
    let sql = `SELECT contracted_rate FROM rate_cards WHERE charge_code = $1`;
    if (input.lane) { sql += ` AND lane = $2`; params.push(input.lane); }
    sql += ` LIMIT 1`;
    const result = await pool.query<{ contracted_rate: string | number }>(sql, params);
    if (result.rows.length > 0) {
      const v = result.rows[0].contracted_rate;
      contractedRate = typeof v === 'string' ? Number(v) : v;
    }
  } catch {
    return { verdict: 'AMBER', contracted_rate: null, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_FOUND' };
  }
  if (contractedRate === null) return { verdict: 'AMBER', contracted_rate: null, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_FOUND' };
  const appliedRate = input.applied_rate;
  if (appliedRate === null) return { verdict: 'AMBER', contracted_rate: contractedRate, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_APPLIED' };
  const variancePct = contractedRate !== 0 ? ((appliedRate - contractedRate) / contractedRate) * 100 : 0;
  const absVariance = Math.abs(variancePct);
  const rounded = Math.round(variancePct * 100) / 100;
  if (absVariance <= 2) return { verdict: 'PASS', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: null };
  if (absVariance <= 5) return { verdict: 'AMBER', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_VARIANCE' };
  return { verdict: 'ZERO', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_EXCEEDS_THRESHOLD' };
}

export interface RateCardBatchEntry {
  charge_code: string;
  contracted_rate: number | null;
  applied_rate: number | null;
}

export async function check_rate_card_batch(chargeCodes: string[]): Promise<Map<string, RateCardBatchEntry>> {
  const result = new Map<string, RateCardBatchEntry>();
  if (chargeCodes.length === 0) return result;

  const uniqueCodes = [...new Set(chargeCodes)];

  try {
    const pool = getPool();
    const sql = `SELECT charge_code, contracted_rate, applied_rate FROM rate_cards WHERE charge_code = ANY($1)`;
    const dbResult = await pool.query<{ charge_code: string; contracted_rate: string | number; applied_rate: string | number | null }>(sql, [uniqueCodes]);

    for (const row of dbResult.rows) {
      const contracted_rate = typeof row.contracted_rate === 'string' ? Number(row.contracted_rate) : row.contracted_rate;
      const applied_rate = row.applied_rate != null
        ? (typeof row.applied_rate === 'string' ? Number(row.applied_rate) : row.applied_rate)
        : null;
      result.set(row.charge_code, { charge_code: row.charge_code, contracted_rate, applied_rate });
    }
  } catch {
    // fall through — missing codes handled below
  }

  for (const code of uniqueCodes) {
    if (!result.has(code)) {
      try {
        const pool = getPool();
        const sql = `SELECT contracted_rate, applied_rate FROM rate_cards WHERE charge_code = $1 LIMIT 1`;
        const dbResult = await pool.query<{ contracted_rate: string | number; applied_rate: string | number | null }>(sql, [code]);
        if (dbResult.rows.length > 0) {
          const row = dbResult.rows[0];
          const contracted_rate = typeof row.contracted_rate === 'string' ? Number(row.contracted_rate) : row.contracted_rate;
          const applied_rate = row.applied_rate != null
            ? (typeof row.applied_rate === 'string' ? Number(row.applied_rate) : row.applied_rate)
            : null;
          result.set(code, { charge_code: code, contracted_rate, applied_rate });
        }
      } catch {
        // skip — code unfound
      }
    }
  }

  return result;
}

export const run = check_rate_card;

export async function run_batch(inputs: CheckRateCardInput[]): Promise<CheckRateCardOutput[]> {
  if (inputs.length === 0) return [];

  const chargeCodes = inputs.map(i => i.charge_code);
  const batch = await check_rate_card_batch(chargeCodes);

  return inputs.map(input => {
    const entry = batch.get(input.charge_code);

    if (!entry || entry.contracted_rate === null) {
      return { verdict: 'AMBER', contracted_rate: null, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_FOUND' };
    }

    const contractedRate = entry.contracted_rate;
    const appliedRate = entry.applied_rate ?? input.applied_rate;

    if (appliedRate === null) {
      return { verdict: 'AMBER', contracted_rate: contractedRate, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_APPLIED' };
    }

    const variancePct = contractedRate !== 0 ? ((appliedRate - contractedRate) / contractedRate) * 100 : 0;
    const absVariance = Math.abs(variancePct);
    const rounded = Math.round(variancePct * 100) / 100;

    if (absVariance <= 2) return { verdict: 'PASS', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: null };
    if (absVariance <= 5) return { verdict: 'AMBER', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_VARIANCE' };
    return { verdict: 'ZERO', contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_EXCEEDS_THRESHOLD' };
  });
}
