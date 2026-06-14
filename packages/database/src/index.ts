import pg from 'pg';

const { Pool } = pg;

export type PgPool = pg.Pool;

let _pool: PgPool | null = null;

export interface PoolOptions {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export function getPool(opts?: PoolOptions): PgPool {
  if (_pool) return _pool;

  const connectionString = opts?.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim() === '') {
    throw new Error('DATABASE_URL is not configured.');
  }

  _pool = new Pool({
    connectionString,
    max: opts?.max ?? Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: opts?.idleTimeoutMillis ?? Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: opts?.connectionTimeoutMillis ?? Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000)
  });

  _pool.on('error', (err) => {
    console.error('[invoice-audit/database] idle pg client error:', err);
  });

  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export function __setPoolForTesting(pool: PgPool | null): void {
  _pool = pool;
}
