import { getPool } from '@invoice-audit/database';
import type { Currency } from '@invoice-audit/contracts/invoice';
import {
  RATE_MANIFEST_VERSION,
  type ExecutedRate,
  type RateLookupInput,
  type RateReferenceProvider,
} from './rateReferenceProvider';

/**
 * PostgresRateReferenceProvider — Neon PG `rate_cards` table lookup.
 *
 * Maps the rate_cards schema (0016_rate_cards.sql) to ExecutedRate:
 *   - charge_code / lane     -> RateLookupInput.serviceCode / laneCode
 *   - contracted_rate (NUMERIC) -> amountMinor (USD/AED minor units)
 *   - effective_from / to    -> executedRate.effectiveFrom / To
 *   - currency               -> executedRate.currency
 *
 * Note: the underlying column is NUMERIC(12,4); we multiply by 100
 * to convert to minor units (cents/fil). If the source rate is not
 * already minor-unit-aligned the caller is responsible for normalization.
 *
 * Workflow:
 *   - SHIPMENT: WHERE charge_code = $1 AND lane = $2
 *   - DOMESTIC: WHERE lane = $1 AND workflow_type = 'DOMESTIC'
 *
 * @see PLAN_20260616_160103.md PR 4.2
 * @see migrations/0016_rate_cards.sql
 */

interface RateCardRow {
  id: number | string;
  charge_code: string | null;
  lane: string | null;
  contracted_rate: string | number;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  workflow_type: string;
}

export class PostgresRateReferenceProvider implements RateReferenceProvider {
  async getExecutedRate(input: RateLookupInput): Promise<ExecutedRate | null> {
    let pool;
    try {
      pool = getPool();
    } catch {
      // No DATABASE_URL or PG init failed — provider cannot serve (Rule #0: never throw on
      // rate lookup, return null so the validation layer falls back to MISSING_RATE).
      return null;
    }

    const sql = input.workflowType === 'DOMESTIC'
      ? `SELECT id, charge_code, lane, contracted_rate, currency,
                effective_from, effective_to, workflow_type
           FROM rate_cards
           WHERE lane = $1
             AND workflow_type = 'DOMESTIC'
             AND currency = $2
             AND effective_from <= $3
             AND (effective_to IS NULL OR effective_to >= $3)
           ORDER BY effective_from DESC
           LIMIT 1`
      : `SELECT id, charge_code, lane, contracted_rate, currency,
                effective_from, effective_to, workflow_type
           FROM rate_cards
           WHERE charge_code = $1
             AND lane = $2
             AND currency = $3
             AND effective_from <= $4
             AND (effective_to IS NULL OR effective_to >= $4)
           ORDER BY effective_from DESC
           LIMIT 1`;

    const params = input.workflowType === 'DOMESTIC'
      ? [input.laneCode, input.currency, input.effectiveDate]
      : [input.serviceCode, input.laneCode, input.currency, input.effectiveDate];

    let result;
    try {
      result = await pool.query<RateCardRow>(sql, params);
    } catch {
      // Schema drift / 42P01 / transient PG error — treat as missing (Rule #0).
      return null;
    }
    const row = result.rows[0];
    if (!row) return null;

    const numeric = typeof row.contracted_rate === 'string'
      ? Number(row.contracted_rate)
      : row.contracted_rate;
    if (!Number.isFinite(numeric)) return null;

    return {
      rateId: `rc_${row.id}`,
      amountMinor: Math.round(numeric * 100),  // NUMERIC(12,4) → minor units
      currency: row.currency as Currency,
      manifestVersion: RATE_MANIFEST_VERSION,
      effectiveFrom: row.effective_from ?? input.effectiveDate,
      effectiveTo: row.effective_to,
    };
  }
}
