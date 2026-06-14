/**
 * Postgres connection helper (singleton pg.Pool) for in-process MCP tools.
 * Ported from apps/mcp-server/src/db.ts (no workspace — web cannot import it).
 *
 * Reads `DATABASE_URL` from the environment. If missing, throws on first use so
 * the calling tool (check_rate_card) surfaces a clear config error and degrades
 * to AMBER rather than hanging.
 */
import pg from 'pg';

const { Pool } = pg;

export type PgPool = pg.Pool;

let _pool: PgPool | null = null;

export function getPool(): PgPool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === '') {
    throw new Error('DATABASE_URL is not configured.');
  }

  _pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000)
  });

  _pool.on('error', (err) => {
    console.error('[mcp] idle pg client error:', err);
  });

  return _pool;
}
