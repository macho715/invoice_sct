import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '../check_fx_policy.js';

describe('check_fx_policy', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_fx_policy');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns PASS for same currency (AED to AED)', async () => {
    const result = await run({
      from_currency: 'AED',
      to_currency: 'AED',
      amount: 1000,
      rate_date: null
    });
    expect(result.verdict).toBe('PASS');
    expect(result.applied_rate).toBe(1.0);
    expect(result.policy_rate).toBe(1.0);
    expect(result.variance_pct).toBe(0);
    expect(result.reason_code).toBeNull();
  });

  it('returns PASS for same currency (USD to USD)', async () => {
    const result = await run({
      from_currency: 'USD',
      to_currency: 'USD',
      amount: 500,
      rate_date: '2026-06-13'
    });
    expect(result.verdict).toBe('PASS');
    expect(result.applied_rate).toBe(1.0);
    expect(result.policy_rate).toBe(1.0);
  });

  it('returns AMBER with FX_RATE_UNVERIFIABLE for AED/USD pair', async () => {
    const result = await run({
      from_currency: 'USD',
      to_currency: 'AED',
      amount: 1000,
      rate_date: '2026-06-13'
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('FX_RATE_UNVERIFIABLE');
    expect(result.policy_rate).toBe(3.6725);
    expect(result.applied_rate).toBeNull();
    expect(result.variance_pct).toBeNull();
  });

  it('returns AMBER for AED to USD direction', async () => {
    const result = await run({
      from_currency: 'AED',
      to_currency: 'USD',
      amount: 3672.5,
      rate_date: null
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.policy_rate).toBe(3.6725);
  });

  it('returns AMBER for unsupported currency pair', async () => {
    const result = await run({
      from_currency: 'EUR',
      to_currency: 'GBP',
      amount: 1000,
      rate_date: null
    });
    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('FX_RATE_UNVERIFIABLE');
    expect(result.policy_rate).toBeNull();
  });
});
