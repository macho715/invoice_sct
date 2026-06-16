import { InMemoryRateReferenceProvider } from './inMemoryRateReferenceProvider';
import { PostgresRateReferenceProvider } from './postgresRateReferenceProvider';
import type { RateReferenceProvider } from './rateReferenceProvider';

/**
 * rateReferenceProviderFactory — PR 4.2
 *
 * Single source of truth for "which RateReferenceProvider does this
 * process use". Defers to Postgres when DATABASE_URL is configured
 * (production), falls back to in-memory when not (dev / tests).
 *
 * The factory is intentionally simple — no DI container, no global
 * mutable state. Tests construct InMemoryRateReferenceProvider directly
 * and pass it into the validation pipeline; production code calls
 * `getDefaultRateReferenceProvider()` once at module load.
 *
 * @see PLAN_20260616_160103.md PR 4.2
 */

let cached: RateReferenceProvider | null = null;

export function getDefaultRateReferenceProvider(): RateReferenceProvider {
  if (cached) return cached;
  const hasDatabase = !!process.env.DATABASE_URL;
  cached = hasDatabase
    ? new PostgresRateReferenceProvider()
    : InMemoryRateReferenceProvider.empty();
  return cached;
}

/** Test-only: replace the cached default. */
export function setDefaultRateReferenceProvider(p: RateReferenceProvider | null): void {
  cached = p;
}
