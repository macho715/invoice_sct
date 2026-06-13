import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../db.js', () => ({
  getPool: () => ({
    query: queryMock
  })
}));

import { run, TOOL_VERSION, ToolName } from '../match_shipment_reference.js';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
});

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('match_shipment_reference', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('match_shipment_reference');
    expect(TOOL_VERSION).toBe('0.2.0');
  });

  it('returns ZERO when all input fields are null', async () => {
    const result = await run({
      shipment_ref: null,
      job_number: null,
      bl_number: null,
      do_number: null
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.matches).toEqual([]);
  });

  it('returns AMBER when DB is unavailable', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const result = await run({
      shipment_ref: 'SH-001',
      job_number: null,
      bl_number: null,
      do_number: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.matches).toEqual([]);
  });

  it('returns PASS when all four fields are provided and DB is available', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await run({
      shipment_ref: 'SH-001',
      job_number: 'JOB-001',
      bl_number: 'BL-001',
      do_number: 'DO-001'
    });

    expect(result.verdict).toBe('PASS');
    expect(result.matches).toHaveLength(4);
    expect(result.matches.find((m) => m.matched_via === 'bl_number')?.confidence).toBe(0.95);
    expect(result.matches.find((m) => m.matched_via === 'shipment_ref')?.confidence).toBe(0.9);
    expect(result.matches.find((m) => m.matched_via === 'job_number')?.confidence).toBe(0.85);
    expect(result.matches.find((m) => m.matched_via === 'do_number')?.confidence).toBe(0.8);
  });

  it('returns AMBER when only some fields are provided and DB is available', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await run({
      shipment_ref: 'SH-001',
      job_number: null,
      bl_number: 'BL-001',
      do_number: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.matches).toHaveLength(2);
  });

  it('returns AMBER when only one field is provided and DB is available', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await run({
      shipment_ref: null,
      job_number: null,
      bl_number: 'BL-001',
      do_number: null
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matched_via).toBe('bl_number');
    expect(result.matches[0].confidence).toBe(0.95);
  });
});
