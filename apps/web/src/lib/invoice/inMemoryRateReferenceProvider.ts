import {
  RATE_MANIFEST_VERSION,
  type ExecutedRate,
  type RateLookupInput,
  type RateReferenceProvider,
} from './rateReferenceProvider';
import type { Currency } from '@invoice-audit/contracts/invoice';

/**
 * In-memory RateReferenceProvider — for tests and ephemeral dev runs.
 *
 * Stores rows in a Map keyed by `${serviceCode}|${laneCode}|${currency}`.
 * Multi-currency: same lane with different currencies coexist.
 *
 * @see PLAN_20260616_160103.md PR 4.2
 */

export interface InMemoryRateRow {
  rateId: string;
  serviceCode: string;
  laneCode: string;
  vendorId: string;
  amountMinor: number;
  currency: Currency;
  effectiveFrom: string;   // YYYY-MM-DD
  effectiveTo: string | null;  // YYYY-MM-DD | null = open-ended
}

export class InMemoryRateReferenceProvider implements RateReferenceProvider {
  private readonly rows: InMemoryRateRow[];

  constructor(rows: InMemoryRateRow[] = []) {
    this.rows = rows;
  }

  static empty(): InMemoryRateReferenceProvider {
    return new InMemoryRateReferenceProvider([]);
  }

  /** Test-only builder: add a row and return the same instance. */
  withRow(row: InMemoryRateRow): InMemoryRateReferenceProvider {
    this.rows.push(row);
    return this;
  }

  async getExecutedRate(input: RateLookupInput): Promise<ExecutedRate | null> {
    const match = this.rows.find((r) => {
      if (r.vendorId !== input.vendorId) return false;
      if (r.serviceCode !== input.serviceCode) return false;
      if (r.laneCode !== input.laneCode) return false;
      if (r.currency !== input.currency) return false;
      if (r.effectiveFrom > input.effectiveDate) return false;
      if (r.effectiveTo !== null && r.effectiveTo < input.effectiveDate) return false;
      return true;
    });
    if (!match) return null;
    return {
      rateId: match.rateId,
      amountMinor: match.amountMinor,
      currency: match.currency,
      manifestVersion: RATE_MANIFEST_VERSION,
      effectiveFrom: match.effectiveFrom,
      effectiveTo: match.effectiveTo,
    };
  }
}
