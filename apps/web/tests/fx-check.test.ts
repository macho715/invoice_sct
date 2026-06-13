import { describe, it, expect } from 'vitest';
import { STORE } from '../src/lib/job-store';
import { checkAndConvertCurrency } from '../src/lib/fx-check';

describe('fx-check', () => {
  it('same currency requires no policy', async () => {
    const res = await checkAndConvertCurrency('AED', 'AED', 100);
    expect(res.allowed).toBe(true);
    expect(res.converted_amount).toBe(100);
  });

  it('cross currency without policy fails with FX_POLICY_REQUIRED', async () => {
    const res = await checkAndConvertCurrency('AED', 'JPY', 100);
    expect(res.allowed).toBe(false);
    expect(res.error_code).toBe('FX_POLICY_REQUIRED');
  });

  it('cross currency with valid policy succeeds and converts amount', async () => {
    const policy = {
      fx_policy_id: 'pol_1',
      from_currency: 'AED',
      to_currency: 'USD',
      fx_rate: 0.2723,
      rate_date: '2026-06-09T12:00:00Z',
      valid_from: '2026-06-01T00:00:00Z',
      valid_to: '2026-06-30T23:59:59Z',
      approved_by: 'FINANCE_APPROVER',
      proof_hash: 'abc123hash'
    };
    await STORE.createFxPolicy(policy);

    const res = await checkAndConvertCurrency('AED', 'USD', 100, '2026-06-09T12:00:00Z');
    expect(res.allowed).toBe(true);
    expect(res.fx_rate).toBe(0.2723);
    expect(res.converted_amount).toBe(27.23);
    expect(res.fx_policy_id).toBe('pol_1');
  });

  it('cross currency with policy outside validity window fails with FX_POLICY_REQUIRED', async () => {
    const policy = {
      fx_policy_id: 'pol_2',
      from_currency: 'AED',
      to_currency: 'EUR',
      fx_rate: 0.25,
      rate_date: '2026-06-09T12:00:00Z',
      valid_from: '2026-06-01T00:00:00Z',
      valid_to: '2026-06-30T23:59:59Z',
      approved_by: 'FINANCE_APPROVER',
      proof_hash: 'abc123hash'
    };
    await STORE.createFxPolicy(policy);

    const res = await checkAndConvertCurrency('AED', 'EUR', 100, '2026-07-09T12:00:00Z');
    expect(res.allowed).toBe(false);
    expect(res.error_code).toBe('FX_POLICY_REQUIRED');
  });

  it('policy with rate_date outside valid window fails with FX_POLICY_VALIDATION_FAILED', async () => {
    const policy = {
      fx_policy_id: 'pol_3',
      from_currency: 'AED',
      to_currency: 'GBP',
      fx_rate: 0.22,
      rate_date: '2026-05-09T12:00:00Z', // rate_date is before valid_from
      valid_from: '2026-06-01T00:00:00Z',
      valid_to: '2026-06-30T23:59:59Z',
      approved_by: 'FINANCE_APPROVER',
      proof_hash: 'abc123hash'
    };
    await STORE.createFxPolicy(policy);

    const res = await checkAndConvertCurrency('AED', 'GBP', 100, '2026-06-09T12:00:00Z');
    expect(res.allowed).toBe(false);
    expect(res.error_code).toBe('FX_POLICY_VALIDATION_FAILED');
  });
});
