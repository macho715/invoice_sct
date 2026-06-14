import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(() => ({
      query: mockQuery,
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue({
        query: mockQuery,
        release: vi.fn(),
      }),
    })),
  },
}));

const JOB_ID = 'job_test_pg_123';
const TEST_DB_URL = 'postgresql://test:test@localhost:5432/testdb';

describe('job-store-pg', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
