import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../db.js', () => ({
  getPool: () => ({
    query: queryMock
  })
}));

import { run, TOOL_VERSION, ToolName } from '../check_rate_card.js';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
});

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('check_rate_card', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_rate_card');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns AMBER with RATE_NOT_FOUND when DB is unavailable', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('RATE_NOT_FOUND');
    expect(result.contracted_rate).toBeNull();
  });

  it('returns AMBER with RATE_NOT_FOUND when no rate card exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: null,
      rate_basis: null,
      effective_date: null,
      applied_rate: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('RATE_NOT_FOUND');
  });

  it('returns AMBER with RATE_NOT_APPLIED when rate found but applied_rate is null', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ contracted_rate: '1500.00' }]
    });

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('RATE_NOT_APPLIED');
    expect(result.contracted_rate).toBe(1500);
    expect(result.applied_rate).toBeNull();
  });

  it('queries with lane filter when lane is provided', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: null
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM\s+rate_cards/i);
    expect(sql).toMatch(/charge_code\s*=\s*\$1/);
    expect(sql).toMatch(/lane\s*=\s*\$2/);
    expect(params).toEqual(['TRANSPORT', 'Jebel Ali-Dammam']);
  });

  it('queries without lane filter when lane is null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await run({
      charge_code: 'DEMURRAGE',
      lane: null,
      rate_basis: null,
      effective_date: null,
      applied_rate: null
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/lane/);
    expect(params).toEqual(['DEMURRAGE']);
  });

  it('returns PASS when variance is within 2%', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ contracted_rate: '1500.00' }]
    });

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: 1520.00
    });

    expect(result.verdict).toBe('PASS');
    expect(result.reason_code).toBeNull();
    expect(result.contracted_rate).toBe(1500);
    expect(result.applied_rate).toBe(1520);
    expect(result.variance_pct).toBeCloseTo(1.33, 1);
  });

  it('returns ZERO when variance exceeds 5%', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ contracted_rate: '1500.00' }]
    });

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: 1650.00
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('RATE_EXCEEDS_THRESHOLD');
    expect(result.contracted_rate).toBe(1500);
    expect(result.applied_rate).toBe(1650);
    expect(result.variance_pct).toBeCloseTo(10, 0);
  });

  it('returns AMBER when variance is between 2% and 5%', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ contracted_rate: '1500.00' }]
    });

    const result = await run({
      charge_code: 'TRANSPORT',
      lane: 'Jebel Ali-Dammam',
      rate_basis: null,
      effective_date: null,
      applied_rate: 1555.00
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('RATE_VARIANCE');
    expect(result.contracted_rate).toBe(1500);
    expect(result.applied_rate).toBe(1555);
    expect(result.variance_pct).toBeCloseTo(3.67, 1);
  });
});
