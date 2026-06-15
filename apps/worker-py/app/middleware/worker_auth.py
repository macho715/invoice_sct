"""Worker app-token auth gate.

The parser worker runs on Cloud Run with public invocation (so Vercel — which
has no Google service-account credentials — can reach it). To keep the endpoints
from being open to the world, this middleware enforces a shared secret: callers
must send ``Authorization: Bearer <PARSER_WORKER_TOKEN>``. Vercel already sends
exactly this header (see web ``parser-client.ts``), so no web change is needed.

Design points
-------------
* Built on Starlette ``BaseHTTPMiddleware`` (same as the audit middleware).
* The token is read from the environment **at request time**, not import time,
  so tests and local dev can toggle it per-case.
* **Gate disabled when the token is unset/empty** — local dev, pytest, and any
  environment that does not configure ``PARSER_WORKER_TOKEN`` are unaffected.
  Enforcement only kicks in once the secret is configured (i.e. in prod).
* Always-open paths: health checks (Cloud Run liveness), docs, and CORS
  preflight (``OPTIONS``) must never be blocked.
* Constant-time comparison to avoid leaking the token via timing.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# Paths that must remain reachable without the shared secret.
_OPEN_PATH_PREFIXES = ("/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico")

_TOKEN_ENV = "PARSER_WORKER_TOKEN"


def _expected_token() -> str:
    """Read the shared secret at request time (empty string = gate disabled)."""
    return (os.environ.get(_TOKEN_ENV) or "").strip()


def _extract_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


class WorkerAuthMiddleware(BaseHTTPMiddleware):
    """Reject requests lacking the shared ``PARSER_WORKER_TOKEN`` bearer.

    No-op when the token env var is unset (dev/test). Health/docs/OPTIONS are
    always allowed so Cloud Run liveness and CORS preflight keep working.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        expected = _expected_token()
        if not expected:
            # Gate disabled — no secret configured (local/dev/test).
            return await call_next(request)

        path = request.url.path
        if request.method == "OPTIONS" or any(path.startswith(p) for p in _OPEN_PATH_PREFIXES):
            return await call_next(request)

        presented = _extract_bearer(request.headers.get("authorization"))
        if presented is None or not hmac.compare_digest(presented, expected):
            logger.warning("worker auth rejected: %s %s", request.method, path)
            return JSONResponse(status_code=401, content={"detail": "WORKER_AUTH_REQUIRED"})

        return await call_next(request)
