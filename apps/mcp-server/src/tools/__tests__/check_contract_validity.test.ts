import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('@invoice-audit/database', () => ({
  getPool: () => ({
    query: queryMock
  })
}));

import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/check_contract_validity';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
});

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('check_contract_validity', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_contract_validity');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns ZERO with CONTRACT_NOT_FOUND when DB is unavailable', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const result = await run({
      vendor_hash: 'abc123',
      contract_id: null,
      check_date: '2026-06-13'
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('CONTRACT_NOT_FOUND');
  });

  it('returns ZERO with CONTRACT_NOT_FOUND when no contract exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await run({
      vendor_hash: 'abc123',
      contract_id: null,
      check_date: '2026-06-13'
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('CONTRACT_NOT_FOUND');
  });

  it('returns PASS when check_date is within contract validity', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        contract_id: 'CTR-001',
        valid_from: new Date('2026-01-01'),
        valid_to: new Date('2026-12-31')
      }]
    });

    const result = await run({
      vendor_hash: 'abc123',
      contract_id: null,
      check_date: '2026-06-13'
    });

    expect(result.verdict).toBe('PASS');
    expect(result.contract_id).toBe('CTR-001');
    expect(result.valid_from).toBe('2026-01-01');
    expect(result.valid_to).toBe('2026-12-31');
    expect(result.reason_code).toBeNull();
  });

  it('returns ZERO with CONTRACT_EXPIRED when check_date is after valid_to', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        contract_id: 'CTR-002',
        valid_from: '2025-01-01',
        valid_to: '2025-12-31'
      }]
    });

    const result = await run({
      vendor_hash: 'abc123',
      contract_id: null,
      check_date: '2026-06-13'
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('CONTRACT_EXPIRED');
  });

  it('returns ZERO with CONTRACT_NOT_YET_ACTIVE when check_date is before valid_from', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        contract_id: 'CTR-003',
        valid_from: '2027-01-01',
        valid_to: '2027-12-31'
      }]
    });

    const result = await run({
      vendor_hash: 'abc123',
      contract_id: null,
      check_date: '2026-06-13'
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('CONTRACT_NOT_YET_ACTIVE');
  });

  it('filters by contract_id when provided', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await run({
      vendor_hash: 'abc123',
      contract_id: 'CTR-001',
      check_date: '2026-06-13'
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/contract_id\s*=\s*\$2/);
    expect(params).toEqual(['abc123', 'CTR-001']);
  });
});
