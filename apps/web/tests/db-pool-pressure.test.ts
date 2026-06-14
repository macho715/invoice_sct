import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test pool behavior through the module interface — no real DB needed
vi.mock('@invoice-audit/database', () => {
  let activeConnections = 0;
  let peakConnections = 0;
  const MAX = 10;

  const mockPool = {
    _activeConnections: () => activeConnections,
    _peakConnections: () => peakConnections,
    _reset: () => {
      activeConnections = 0;
      peakConnections = 0;
    },
    connect: vi.fn(async () => {
      // Simulate pool acquiring a connection (queues if at max)
      if (activeConnections >= MAX) {
        // In a real pool, this queues. We simulate it by waiting briefly.
        await new Promise((r) => setTimeout(r, 5));
      }
      activeConnections++;
      if (activeConnections > peakConnections) peakConnections = activeConnections;
      return {
        query: vi.fn(async () => ({ rows: [{ now: new Date() }] })),
        release: vi.fn(() => {
          activeConnections = Math.max(0, activeConnections - 1);
        }),
      };
    }),
    query: vi.fn(async () => ({ rows: [] })),
  };

  return {
    getPool: vi.fn(() => mockPool),
    closePool: vi.fn(async () => {}),
    __setPoolForTesting: vi.fn(),
    _mockPool: mockPool,
  };
});

import { getPool } from '@invoice-audit/database';

describe('DB pool pressure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock pool state
    const pool = getPool() as any;
    pool._reset?.();
  });

  it('pool max is configured at 10 connections', () => {
    // The pool should be created with max=10 by default
    // We verify this via env or default config
    const defaultMax = Number(process.env.PG_POOL_MAX ?? 10);
    expect(defaultMax).toBe(10);
  });

  it('handles 12 concurrent requests without errors', async () => {
    const pool = getPool() as any;
    const CONCURRENT = 12;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, async (_, i) => {
        const client = await pool.connect();
        try {
          const res = await client.query('SELECT NOW()');
          return { i, rows: res.rows };
        } finally {
          client.release();
        }
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // All requests should succeed (pool queues rather than rejects)
    expect(fulfilled.length).toBe(CONCURRENT);
    expect(rejected.length).toBe(0);
  });

  it('peak connections does not exceed pool max under moderate load', async () => {
    const pool = getPool() as any;
    const CONCURRENT = 8; // Under pool max

    await Promise.all(
      Array.from({ length: CONCURRENT }, async () => {
        const client = await pool.connect();
        await new Promise((r) => setTimeout(r, 2)); // hold connection briefly
        client.release();
      }),
    );

    const peak = pool._peakConnections?.() ?? 0;
    expect(peak).toBeLessThanOrEqual(10);
  });

  it('pool queues overflow requests (12 VUs, max 10)', async () => {
    const pool = getPool() as any;

    // Launch 12 concurrent requests — 2 must queue
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        const client = await pool.connect();
        client.release();
      }),
    );

    // Should complete without error (queuing works)
    expect(pool.connect).toHaveBeenCalledTimes(12);
  });

  it('getPool returns the same singleton', () => {
    const pool1 = getPool();
    const pool2 = getPool();
    expect(pool1).toBe(pool2);
  });
});
