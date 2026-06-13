/**
 * Postgres connection helper (singleton pg.Pool).
 *
 * Reads `DATABASE_URL` from the process environment. The connection string
 * MUST be supplied via env vars — never hardcoded. If it is missing we throw
 * immediately on first use so the tool surfaces a clear configuration error
 * rather than silently hanging.
 *
 * The pool is created lazily on first `getPool()` call and reused across
 * invocations. Tests inject a mocked pool via `__setPoolForTesting`.
 */
import pg from 'pg';

const { Pool } = pg;

export type PgPool = pg.Pool;

let _pool: PgPool | null = null;

export function getPool(): PgPool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === '') {
    throw new Error(
      'DATABASE_URL is not configured. Set the environment variable before starting the MCP server.'
    );
  }

  _pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000)
  });

  // Surface unexpected idle-client errors instead of swallowing them.
  _pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[mcp-server] idle pg client error:', err);
  });

  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Test-only escape hatch. Replaces the singleton pool with a mock and resets
 * the lazy initializer. Production code must not call this.
 */
export function __setPoolForTesting(pool: PgPool | null): void {
  _pool = pool;
}
