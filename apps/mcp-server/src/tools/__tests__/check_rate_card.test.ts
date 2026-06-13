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
      effective_date: null
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
      effective_date: null
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
      effective_date: null
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
      effective_date: null
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
      effective_date: null
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/lane/);
    expect(params).toEqual(['DEMURRAGE']);
  });
});
