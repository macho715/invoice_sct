"""Database connection pool helper for the worker-py service.

FR-025 audit middleware uses this module to insert into `audit_traces` and
`approvals` tables. The pool is lazy-initialized on first call to
``get_pool()`` and falls back gracefully (logs to stderr, returns None) when
the database is unreachable so that the HTTP request still succeeds — audit
loss is preferred over blocking the user-facing workflow.

Connection settings are read from the ``DATABASE_URL`` environment variable
(Neon Postgres / standard libpq URL).
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Public type alias for the pool. The real value is None when DB is unavailable.
PoolT = Any

_lock = threading.Lock()
_pool: Optional[PoolT] = None
_init_attempted: bool = False


def _build_pool() -> Optional[PoolT]:
    """Build a ThreadedConnectionPool. Returns None on any failure (fail-soft)."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        logger.warning("DATABASE_URL is not set; audit logging disabled (fail-soft)")
        return None

    try:
        # Imported lazily so that the module is importable in test envs
        # without psycopg2 installed.
        from psycopg2.pool import ThreadedConnectionPool  # type: ignore[import-not-found]

        # Min 1, max 8 — modest defaults for a single worker. Tune via env.
        minconn = int(os.environ.get("DB_POOL_MIN", "1"))
        maxconn = int(os.environ.get("DB_POOL_MAX", "8"))

        pool = ThreadedConnectionPool(minconn=minconn, maxconn=maxconn, dsn=dsn)
        logger.info("Initialized DB connection pool (min=%d, max=%d)", minconn, maxconn)
        return pool
    except Exception as exc:  # noqa: BLE001 - any init error must be fail-soft
        logger.error("Failed to initialize DB pool: %s", exc, exc_info=True)
        return None


def get_pool() -> Optional[PoolT]:
    """Return the process-wide connection pool, creating it on first use.

    Returns ``None`` when the database is unavailable. Callers MUST handle
    the None case — audit writes become no-ops rather than blocking the
    request lifecycle.
    """
    global _pool, _init_attempted
    if _pool is not None:
        return _pool
    with _lock:
        if _pool is not None:
            return _pool
        if _init_attempted:
            # Another thread already failed; return None without retrying
            return None
        _init_attempted = True
        _pool = _build_pool()
    return _pool


def reset_pool() -> None:
    """Close the pool (if any) and clear the cached reference.

    Intended for tests so each test gets a clean state.
    """
    global _pool, _init_attempted
    with _lock:
        if _pool is not None:
            try:
                _pool.closeall()
            except Exception:  # noqa: BLE001
                pass
        _pool = None
        _init_attempted = False


def is_available() -> bool:
    """Return True if a usable pool is currently available."""
    return get_pool() is not None


class _NullPool:
    """Sentinel pool used by tests to inspect what was inserted without
    touching a real database. The middleware sees this as a normal pool
    object exposing ``getconn``/``putconn``/``closeall``."""

    def __init__(self) -> None:
        self.queries: list[tuple[str, tuple[Any, ...]]] = []
        self.should_fail: bool = False

    def getconn(self):
        if self.should_fail:
            raise RuntimeError("simulated DB outage")
        return _NullConn(self)

    def putconn(self, _conn) -> None:  # pragma: no cover - trivial
        return None

    def closeall(self) -> None:  # pragma: no cover - trivial
        return None


class _NullConn:
    def __init__(self, pool: _NullPool) -> None:
        self._pool = pool

    def cursor(self):
        outer = self._pool

        class _Cur:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, exc_type, exc, tb):
                return False

            def execute(self_inner, sql, params=None):
                outer.queries.append((sql, params or ()))

            def fetchone(self_inner):
                return None

            def close(self_inner):
                return None

        return _Cur()

    def commit(self):  # pragma: no cover - trivial
        return None

    def rollback(self):  # pragma: no cover - trivial
        return None
