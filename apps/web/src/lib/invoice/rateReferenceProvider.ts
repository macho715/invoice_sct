import { z } from 'zod';
import { CurrencySchema } from '@invoice-audit/contracts/invoice';

/**
 * lib/invoice/rateReferenceProvider.ts — PR 4.1
 *
 * Rate reference lookup abstraction. Decouples validation code from
 * the concrete rate-card storage (Postgres / InMemory / future sources
 * like SCNT domestic ledger, Ofco, DSV rate sheets, etc.).
 *
 * Contract:
 *   getExecutedRate({ vendorId, laneCode, serviceCode, effectiveDate, currency })
 *     -> ExecutedRate | null
 *
 *   Returns null when no rate card matches the input tuple. The
 *   validation layer treats null as MISSING_RATE / RATE_NOT_FOUND
 *   (rate_match_logic.md §3.D/§3.E).
 *
 *   The `manifestVersion` is stamped onto every successful lookup so
 *   the audit trail can pinpoint which rate-card snapshot was used
 *   even if the underlying table is updated later.
 *
 * @see PLAN_20260616_160103.md PR 4
 * @see patch_g.md §"핵심 문제 2: 요율 참조가 단일 SQL에 하드코딩"
 */

export const RateLookupInputSchema = z.object({
  vendorId: z.string().min(1),
  laneCode: z.string().min(1),         // SHIPMENT: lane; DOMESTIC: composite "origin||destination||vehicle||unit"
  serviceCode: z.string().min(1),     // SHIPMENT: charge_code; DOMESTIC: cost component
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  currency: CurrencySchema,
  // DOMESTIC workflow discriminates lookup key shape from SHIPMENT.
  workflowType: z.enum(['SHIPMENT', 'DOMESTIC']).default('SHIPMENT'),
});
export type RateLookupInput = z.infer<typeof RateLookupInputSchema>;

export const ExecutedRateSchema = z.object({
  rateId: z.string(),                  // PG primary key or provider-generated key
  amountMinor: z.number().int().nonnegative(),  // stored in minor units to avoid float drift
  currency: CurrencySchema,
  manifestVersion: z.string().min(1),  // which rate-card snapshot produced this row
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type ExecutedRate = z.infer<typeof ExecutedRateSchema>;

/**
 * Manifest version is stamped on every rate-card table write so we can
 * tell after the fact which snapshot produced a verdict. Bump this in
 * the same migration that changes rate_cards contents.
 */
export const RATE_MANIFEST_VERSION = '2026-06-16_v1';

export interface RateReferenceProvider {
  /**
   * Look up the contracted rate that applied to the given input on
   * `effectiveDate`. Returns null if no rate card matches.
   *
   * Implementations MUST treat the lookup as read-only and MUST
   * populate `manifestVersion` from a stable source (env var or
   * constant) — never from the row itself, so we always know which
   * version produced the answer.
   */
  getExecutedRate(input: RateLookupInput): Promise<ExecutedRate | null>;
}
