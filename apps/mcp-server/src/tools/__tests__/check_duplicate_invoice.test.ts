/**
 * Unit tests for `check_duplicate_invoice`.
 *
 * Three scenarios:
 *   1. Empty DB → PASS, no duplicates.
 *   2. Exact (vendor + invoice_no + amount) match → ZERO / DUPLICATE_INVOICE.
 *   3. Same (vendor + invoice_no) but different amount → AMBER / AMOUNT_MISMATCH.
 *
 * The pg.Pool is mocked via vi.mock('@invoice-audit/database') so no real DB connection is
 * opened. We also pin the env so `getPool()` is not invoked outside the mock.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db module before importing the tool under test.
const queryMock = vi.fn();

vi.mock('@invoice-audit/database', () => ({
  getPool: () => ({
    query: queryMock
  })
}));

import { run, TOOL_VERSION, ToolName } from '@invoice-audit/tools/check_duplicate_invoice';

const VENDOR_ID = 'V-001';
const VENDOR_NAME = 'DSV Abu Dhabi';
const INVOICE_NO = 'INV-2026-0001';
const VENDOR_HASH = 'a'.repeat(64); // deterministic test fixture
const INVOICE_NO_HASH = 'b'.repeat(64);

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
});

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('check_duplicate_invoice', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('check_duplicate_invoice');
    expect(TOOL_VERSION).toBeTruthy();
  });

  it('returns PASS when the DB has no matching invoice', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await run({
      vendor_hash: VENDOR_HASH,
      invoice_no_hash: INVOICE_NO_HASH,
      amount: 1234.56,
      issue_date: '2026-06-13'
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM\s+invoices/i);
    expect(sql).toMatch(/vendor_hash\s*=\s*\$1/);
    expect(sql).toMatch(/invoice_no_hash\s*=\s*\$2/);
    expect(params).toEqual([VENDOR_HASH, INVOICE_NO_HASH]);

    expect(result).toEqual({
      verdict: 'PASS',
      duplicates: [],
      reason_code: null
    });
  });

  it('returns ZERO with DUPLICATE_INVOICE on an exact (amount, vendor, invoice_no) match', async () => {
    const createdAt = new Date('2026-06-10T08:00:00Z');
    const issueDate = new Date('2026-06-09T00:00:00Z');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          invoice_id: 'inv_001',
          job_id: 'job_001',
          vendor_hash: VENDOR_HASH,
          invoice_no_hash: INVOICE_NO_HASH,
          amount: '1234.56', // pg returns numeric as string by default
          currency: 'AED',
          issue_date: issueDate,
          created_at: createdAt
        }
      ],
      rowCount: 1
    });

    const result = await run({
      vendor_hash: VENDOR_HASH,
      invoice_no_hash: INVOICE_NO_HASH,
      amount: 1234.56,
      issue_date: '2026-06-09'
    });

    expect(result.verdict).toBe('ZERO');
    expect(result.reason_code).toBe('DUPLICATE_INVOICE');
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toMatchObject({
      invoice_id: 'inv_001',
      job_id: 'job_001',
      vendor_hash: VENDOR_HASH,
      invoice_no_hash: INVOICE_NO_HASH,
      amount: 1234.56,
      currency: 'AED',
      issue_date: '2026-06-09',
      created_at: createdAt.toISOString()
    });
  });

  it('returns AMBER with AMOUNT_MISMATCH when amounts differ beyond epsilon', async () => {
    const createdAt = new Date('2026-06-10T08:00:00Z');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          invoice_id: 'inv_002',
          job_id: 'job_002',
          vendor_hash: VENDOR_HASH,
          invoice_no_hash: INVOICE_NO_HASH,
          amount: '1500.00', // prior invoice
          currency: 'AED',
          issue_date: '2026-06-09',
          created_at: createdAt
        }
      ],
      rowCount: 1
    });

    const result = await run({
      vendor_hash: VENDOR_HASH,
      invoice_no_hash: INVOICE_NO_HASH,
      amount: 1234.56, // current invoice — differs by 265.44
      issue_date: '2026-06-13'
    });

    expect(result.verdict).toBe('AMBER');
    expect(result.reason_code).toBe('AMOUNT_MISMATCH');
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].amount).toBe(1500.0);
  });

  it('hashes raw vendor_id + vendor_name + invoice_no when hashes are not supplied', async () => {
    // Sanity check: the contract is that raw values get hashed before query.
    // We don't pin the exact digest (Node crypto + encoding changes over time)
    // but we do pin the shape — the function must hash and pass two 64-char
    // hex strings to pg.
    const { createHash } = await import('node:crypto');
    const expectedVendorHash = createHash('sha256').update(`${VENDOR_ID}|${VENDOR_NAME}`).digest('hex');
    const expectedInvoiceHash = createHash('sha256').update(INVOICE_NO).digest('hex');

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await run({
      vendor_id: VENDOR_ID,
      vendor_name: VENDOR_NAME,
      invoice_no: INVOICE_NO,
      amount: 1,
      issue_date: null
    });

    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([expectedVendorHash, expectedInvoiceHash]);
  });
});
