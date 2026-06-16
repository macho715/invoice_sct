import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery, mockPoolFactory } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockPoolFactory = vi.fn(() => ({
    query: mockQuery,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
  }));
  return { mockQuery, mockPoolFactory };
});

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(() => mockPoolFactory()),
  },
}));

const JOB_ID = 'job_test_pg_123';
const TEST_DB_URL = 'postgresql://test:test@localhost:5432/testdb';

describe('job-store-pg', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPoolFactory.mockImplementation(() => ({
      query: mockQuery,
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue({
        query: mockQuery,
        release: vi.fn(),
      }),
    }));
    vi.resetModules();
    vi.unstubAllEnvs();
    delete globalThis.__invoice_audit_store;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalThis.__invoice_audit_store;
  });

  // ---------- T17 TEST 1 ----------
  describe('createPgJobStore returns null when DATABASE_URL is unset', () => {
    it('returns null if DATABASE_URL env var is missing', async () => {
      delete process.env.DATABASE_URL;

      const { createPgJobStore } = await import('../src/lib/job-store-pg');

      const store = createPgJobStore();
      expect(store).toBeNull();
    });

    it('returns null if DATABASE_URL is empty string', async () => {
      process.env.DATABASE_URL = '';

      const { createPgJobStore } = await import('../src/lib/job-store-pg');

      const store = createPgJobStore();
      expect(store).toBeNull();
    });
  });



  describe('Vercel job-store fallback policy', () => {
    it('does not fall back to in-memory storage when DATABASE_URL is missing on Vercel', async () => {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('DATABASE_URL', '');

      await expect(import('../src/lib/job-store')).rejects.toThrow(
        'Vercel deployment requires DATABASE_URL'
      );
    });

    it('does not fall back to in-memory storage when PG initialization fails on Vercel', async () => {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('DATABASE_URL', TEST_DB_URL);
      mockPoolFactory.mockImplementation(() => {
        throw new Error('pool init failed');
      });

      await expect(import('../src/lib/job-store')).rejects.toThrow(
        'Vercel deployment requires a working Postgres job store'
      );
    });
  });

  // ---------- T17 TEST 2 ----------
  describe('createPgJobStore returns a store when DATABASE_URL is set', () => {
    it('returns a store object with expected method keys', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      const { createPgJobStore } = await import('../src/lib/job-store-pg');

      const store = createPgJobStore();
      expect(store).not.toBeNull();
      expect(store).toHaveProperty('createJob');
      expect(store).toHaveProperty('getJob');
      expect(store).toHaveProperty('updateJob');
      expect(store).toHaveProperty('addSourceFile');
      expect(store).toHaveProperty('listSourceFiles');
      expect(store).toHaveProperty('appendTrace');
      expect(store).toHaveProperty('listTrace');
      expect(store).toHaveProperty('setResult');
      expect(store).toHaveProperty('getResult');
      expect(store).toHaveProperty('setNormalizedInvoice');
      expect(store).toHaveProperty('getNormalizedInvoice');
      expect(store).toHaveProperty('setValidationResult');
      expect(store).toHaveProperty('getValidationResult');
      expect(store).toHaveProperty('setApprovalRecord');
      expect(store).toHaveProperty('getApprovalRecord');
      expect(typeof store!.createJob).toBe('function');
      expect(typeof store!.getJob).toBe('function');
    });
  });

  // ---------- T17 TEST 3 ----------
  describe('createJob returns job with CREATED status', () => {
    it('returns a job with status CREATED and correct fields', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      const now = '2026-06-14T12:00:00.000Z';
      mockQuery.mockResolvedValueOnce({
        rows: [{
          job_id: JOB_ID,
          status: 'CREATED',
          verdict: null,
          created_by: 'u1',
          created_at: new Date(now),
          updated_at: new Date(now),
          rule_version: 'rule-0.1.0',
          parser_version: 'parser-0.1.0',
        }],
      });

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      const job = await store.createJob({
        created_by: 'u1',
        job_id: JOB_ID,
      });

      expect(job.job_id).toBe(JOB_ID);
      expect(job.status).toBe('CREATED');
      expect(job.verdict).toBeNull();
      expect(job.created_by).toBe('u1');
      expect(job.rule_version).toBe('rule-0.1.0');
      expect(job.parser_version).toBe('parser-0.1.0');
      expect(job.created_at).toBe(now);
      expect(job.updated_at).toBe(now);
    });

    it('generates a job_id when not provided', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      mockQuery.mockResolvedValueOnce({
        rows: [{
          job_id: 'job_auto12345678',
          status: 'CREATED',
          verdict: null,
          created_by: 'u2',
          created_at: new Date('2026-06-14T12:00:00.000Z'),
          updated_at: new Date('2026-06-14T12:00:00.000Z'),
          rule_version: 'rule-0.2.0',
          parser_version: 'parser-0.2.0',
        }],
      });

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      const job = await store.createJob({
        created_by: 'u2',
        rule_version: 'rule-0.2.0',
        parser_version: 'parser-0.2.0',
      });

      expect(job.job_id).toMatch(/^job_/);
      expect(job.status).toBe('CREATED');
      expect(job.created_by).toBe('u2');
    });
  });

  // ---------- workflow_type column self-heal (migration 0017) ----------
  describe('createJob self-heals missing workflow_type column (42703)', () => {
    it('adds the column and retries when jobs.workflow_type is missing', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      const now = '2026-06-16T12:00:00.000Z';
      const undefinedColumn = Object.assign(
        new Error('column "workflow_type" of relation "jobs" does not exist'),
        { code: '42703' }
      );
      mockQuery
        // 1st INSERT fails: column does not exist
        .mockRejectedValueOnce(undefinedColumn)
        // self-heal ALTER TABLE
        .mockResolvedValueOnce({ rows: [] })
        // retried INSERT succeeds
        .mockResolvedValueOnce({
          rows: [{
            job_id: JOB_ID,
            status: 'CREATED',
            verdict: null,
            workflow_type: 'SHIPMENT',
            created_by: 'u1',
            created_at: new Date(now),
            updated_at: new Date(now),
            rule_version: 'rule-0.1.0',
            parser_version: 'parser-0.1.0',
          }],
        });

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      const job = await store.createJob({ created_by: 'u1', job_id: JOB_ID });

      expect(job.job_id).toBe(JOB_ID);
      expect(job.workflow_type).toBe('SHIPMENT');
      // INSERT (fail) → ALTER TABLE → INSERT (retry) = 3 queries
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[1][0]).toMatch(/ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_type/);
    });

    it('does not swallow non-42703 errors', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      const otherError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      mockQuery.mockRejectedValueOnce(otherError);

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      await expect(store.createJob({ created_by: 'u1', job_id: JOB_ID })).rejects.toThrow('connection reset');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- T17 TEST 4 ----------
  describe('getJob returns undefined for non-existent jobId', () => {
    it('returns undefined when no rows match', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      const result = await store.getJob('job_nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns a Job object when row exists', async () => {
      process.env.DATABASE_URL = TEST_DB_URL;

      const now = '2026-06-14T13:00:00.000Z';
      mockQuery.mockResolvedValueOnce({
        rows: [{
          job_id: JOB_ID,
          status: 'UPLOADED',
          verdict: null,
          created_by: 'u1',
          created_at: new Date(now),
          updated_at: new Date(now),
          rule_version: 'rule-0.1.0',
          parser_version: 'parser-0.1.0',
        }],
      });

      const { createPgJobStore } = await import('../src/lib/job-store-pg');
      const store = createPgJobStore()!;

      const result = await store.getJob(JOB_ID);
      expect(result).toBeDefined();
      expect(result!.job_id).toBe(JOB_ID);
      expect(result!.status).toBe('UPLOADED');
    });
  });
});
