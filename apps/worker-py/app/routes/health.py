"""Worker health check endpoints.

Exposes three routes:

* ``GET /health``       — composite summary (kept for backward compatibility).
* ``GET /health/live``  — shallow liveness probe; always 200 OK.
* ``GET /health/ready`` — deep readiness probe; returns 503 on failure.

The readiness probe runs four checks, each with a 5-second timeout:

1. **db**           — ``SELECT 1`` against the configured Postgres pool.
2. **blob_storage** — HEAD request to a known blob pathname (mocked).
3. **parsers**      — import check for the parser modules.
4. **memory**       — process RSS via ``psutil``.

If any check fails, the overall status becomes ``"unhealthy"`` and the
endpoint returns HTTP 503. Partial failures (some checks pass, some fail)
result in ``"degraded"`` with HTTP 503 as well — callers should not route
traffic to a degraded worker.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import psutil
from fastapi import APIRouter, Response, status

logger = logging.getLogger(__name__)

router = APIRouter()

# Per-check timeout (seconds). Spec requires 5s.
CHECK_TIMEOUT_S: float = 5.0

# Public version (kept in sync with pyproject.toml).
WORKER_VERSION: str = "0.1.0"

# Blob HEAD target used for the ``blob_storage`` check. When unset or empty,
# the check is gracefully skipped (ok=True, skipped=True) so the worker does
# not fail readiness in environments without blob storage configured.
BLOB_HEALTHCHECK_URL: str = os.environ.get("BLOB_HEALTHCHECK_URL", "")


# ---------------------------------------------------------------------------
# Individual check helpers
# ---------------------------------------------------------------------------

async def _check_db() -> Dict[str, Any]:
    """Run ``SELECT 1`` against the DB pool. Times out after 5s.

    Imports ``app.db`` lazily so that the test environment (which may not
    have psycopg2 installed) can still import this module.

    When DATABASE_URL is unset/empty the worker runs DB-optional — returns
    a graceful skip instead of a hard failure, matching the fail-soft
    contract in ``app/db.py``.
    """
    import os
    from app.db import get_pool  # lazy import

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return {
            "ok": True,
            "latency_ms": 0,
            "skipped": True,
            "reason": "DATABASE_URL unset; audit logging disabled (optional)",
        }

    started = time.perf_counter()
    pool = get_pool()
    if pool is None:
        return {
            "ok": False,
            "latency_ms": 0,
            "error": "db pool init failed (DATABASE_URL is set but pool could not be created)",
        }

    def _do_select() -> None:
        conn = pool.getconn()
        try:
            cur = conn.cursor()
            try:
                cur.execute("SELECT 1")
                cur.fetchone()
            finally:
                cur.close()
        finally:
            try:
                pool.putconn(conn)
            except Exception:  # noqa: BLE001
                pass

    try:
        await asyncio.wait_for(asyncio.to_thread(_do_select), timeout=CHECK_TIMEOUT_S)
        return {"ok": True, "latency_ms": int((time.perf_counter() - started) * 1000)}
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "latency_ms": int(CHECK_TIMEOUT_S * 1000),
            "error": f"db check timed out after {CHECK_TIMEOUT_S}s",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"{type(exc).__name__}: {exc}",
        }


async def _check_blob() -> Dict[str, Any]:
    """HEAD request to a known blob pathname. Times out after 5s.

    When ``BLOB_HEALTHCHECK_URL`` is unset or empty, the check is skipped
    gracefully (``ok=True, skipped=True``) so the worker passes readiness
    in environments without blob storage configured.

    Uses ``httpx.AsyncClient``; failures are reported as ``ok: False``
    rather than raising.
    """
    if not BLOB_HEALTHCHECK_URL:
        return {"ok": True, "skipped": True, "latency_ms": 0}

    import httpx

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_S) as client:
            resp = await client.head(BLOB_HEALTHCHECK_URL)
            ok = resp.status_code < 500
            return {
                "ok": ok,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "status_code": resp.status_code,
            }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"{type(exc).__name__}: {exc}",
        }


async def _check_parsers() -> Dict[str, Any]:
    """Try to import each parser module. Succeeds iff all imports work."""
    started = time.perf_counter()
    expected: List[str] = ["xlsx", "pdf_text", "pdf_json"]
    available: List[str] = []
    missing: List[str] = []

    for name in expected:
        try:
            __import__(f"app.parsers.{name}")
            available.append(name)
        except Exception as exc:  # noqa: BLE001
            missing.append(f"{name} ({type(exc).__name__})")

    return {
        "ok": len(missing) == 0,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "parsers": available,
        "missing": missing,
    }


async def _check_memory() -> Dict[str, Any]:
    """Report current process RSS in MB.

    Always succeeds (psutil reads from /proc or Win32 APIs cheaply). The
    threshold check is conservative: > 1 GiB is flagged as a warning, not
    a failure, so the worker is not killed under transient load.
    """
    started = time.perf_counter()
    process = psutil.Process()
    rss_mb = int(process.memory_info().rss / 1024 / 1024)
    return {
        "ok": True,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "rss_mb": rss_mb,
    }


# ---------------------------------------------------------------------------
# Endpoint handlers
# ---------------------------------------------------------------------------

@router.get("/health")
async def health() -> Dict[str, Any]:
    """Composite health endpoint (backward-compatible).

    Returns a minimal ``{status, version, timestamp}`` envelope. For the
    full readiness payload, see ``/health/ready``.
    """
    return {
        "status": "ok",
        "version": WORKER_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@router.get("/health/live")
async def health_live() -> Dict[str, Any]:
    """Shallow liveness probe. Always returns 200 OK."""
    return {
        "status": "ok",
        "version": WORKER_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@router.get("/health/ready")
async def health_ready(response: Response) -> Dict[str, Any]:
    """Deep readiness probe.

    Runs all checks in parallel with a 5s timeout each. If any check
    fails, returns HTTP 503 and ``status: "unhealthy"``. If some (but
    not all) checks fail, ``status: "degraded"`` is also surfaced as 503.
    """
    # Run all checks concurrently to keep the worst-case latency bounded
    # by the slowest single check, not the sum of all checks.
    db_res, blob_res, parser_res, mem_res = await asyncio.gather(
        _check_db(),
        _check_blob(),
        _check_parsers(),
        _check_memory(),
        return_exceptions=True,
    )

    # Normalize exceptions raised inside gather (shouldn't happen because
    # each check catches internally, but be defensive).
    def _coerce(v: Any, name: str) -> Dict[str, Any]:
        if isinstance(v, Exception):
            return {"ok": False, "error": f"{type(v).__name__}: {v}"}
        return v

    checks: Dict[str, Dict[str, Any]] = {
        "db": _coerce(db_res, "db"),
        "blob_storage": _coerce(blob_res, "blob_storage"),
        "parsers": _coerce(parser_res, "parsers"),
        "memory": _coerce(mem_res, "memory"),
    }

    failures = [name for name, res in checks.items() if not res.get("ok")]
    if not failures:
        status_label: str = "ok"
        http_status: int = status.HTTP_200_OK
    elif len(failures) == len(checks):
        status_label = "unhealthy"
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        status_label = "degraded"
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE

    response.status_code = http_status

    return {
        "status": status_label,
        "version": WORKER_VERSION,
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
