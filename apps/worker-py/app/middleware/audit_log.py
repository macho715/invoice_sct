"""Audit log middleware (FR-025 compliance).

The system MUST treat approval state, approver identity, verdict, export
type, and trace ID as audit data. This middleware persists a row to the
``audit_traces`` table for every request and additionally writes to the
``approvals`` table for ``/api/audit/approve`` calls.

Design points
-------------
* Built on Starlette ``BaseHTTPMiddleware`` so it works with FastAPI.
* Fail-soft: if the DB is unavailable the request still completes; the
  failure is logged to stderr instead of being raised to the caller.
* Reads the request body once (rewound after consumption) so downstream
  handlers can still parse it.
* Honors the ``x-user-id`` header as the actor and falls back to
  ``"anonymous"`` when absent.
* DLP-safe: redact events log the *names* of the redacted fields only —
  never their values. The original request body is referenced by a hash
  for forensics but is not duplicated into the audit row.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path classification (FR-025 event types)
# ---------------------------------------------------------------------------
APPROVE_PATH = "/api/audit/approve"
EXPORT_PATH = "/api/audit/export"
REDACT_PATH = "/api/audit/redact"

# Routes that we always skip — these are noise and would otherwise dominate
# the audit log with high-frequency heartbeats.
_SKIP_PATH_PREFIXES = ("/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico")


def _classify_event(path: str) -> str:
    """Map a request path to one of the FR-025 event_type values."""
    p = path.lower()
    if "/parse" in p:
        return "parse"
    if "/validat" in p:  # /validate, /validation
        return "validate"
    if "/approve" in p:
        return "approve"
    if "/export" in p:
        return "export"
    if "/redact" in p:
        return "redact"
    if "/upload" in p:
        return "upload"
    return "other"


def _should_skip(path: str) -> bool:
    return any(path.startswith(p) for p in _SKIP_PATH_PREFIXES)


# ---------------------------------------------------------------------------
# Safe body reader
# ---------------------------------------------------------------------------
async def _read_body_safely(request: Request) -> tuple[bytes, str]:
    """Read the request body without breaking downstream consumers.

    Returns ``(raw_bytes, content_type)``. If the body is not JSON, we
    still return the raw bytes (truncated) so we can record a hash, but
    we never log the entire binary content.
    """
    try:
        body = await request.body()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not read request body: %s", exc)
        return b"", ""
    # Replay the body for downstream handlers (FastAPI's Request.body()
    # is cached, but route handlers call .json() / .form() which we must
    # not break by exhausting the stream).
    try:
        async def _receive() -> dict:  # pragma: no cover - shim
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    return body, request.headers.get("content-type", "")


def _parse_json(body: bytes) -> Optional[dict[str, Any]]:
    if not body:
        return None
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------------------
# DB writers (no-ops when pool is unavailable)
# ---------------------------------------------------------------------------
def _insert_audit_trace(
    *,
    trace_id: str,
    job_id: Optional[str],
    event_type: str,
    actor: str,
    payload: dict[str, Any],
    verdict: Optional[str] = None,
    approver_role: Optional[str] = None,
    approver_identity: Optional[str] = None,
    approval_state: Optional[str] = None,
    export_type: Optional[str] = None,
) -> None:
    pool = db.get_pool()
    if pool is None:
        logger.warning("audit_traces insert skipped (no DB pool): trace=%s", trace_id)
        return
    sql = (
        "INSERT INTO audit_traces "
        "(trace_id, job_id, event_type, actor, verdict, approver_role, "
        " approver_identity, approval_state, export_type, payload) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)"
    )
    params = (
        trace_id,
        job_id,
        event_type,
        actor,
        verdict,
        approver_role,
        approver_identity,
        approval_state,
        export_type,
        json.dumps(payload),
    )
    conn = None
    try:
        conn = pool.getconn()
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("audit_traces insert failed: %s", exc, exc_info=True)
        if conn is not None:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
    finally:
        if conn is not None:
            try:
                pool.putconn(conn)
            except Exception:  # noqa: BLE001
                pass


def _insert_approval(
    *,
    job_id: str,
    approval_state: str,
    approver_role: str,
    approver_identity: str,
    verdict: str,
    variance_aed: Optional[float],
    comments: Optional[str],
    trace_id: str,
) -> None:
    pool = db.get_pool()
    if pool is None:
        logger.warning("approvals insert skipped (no DB pool): trace=%s", trace_id)
        return
    sql = (
        "INSERT INTO approvals "
        "(job_id, approval_state, approver_role, approver_identity, verdict, "
        " variance_aed, comments, trace_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
    )
    params = (
        job_id,
        approval_state,
        approver_role,
        approver_identity,
        verdict,
        variance_aed,
        comments,
        trace_id,
    )
    conn = None
    try:
        conn = pool.getconn()
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("approvals insert failed: %s", exc, exc_info=True)
        if conn is not None:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
    finally:
        if conn is not None:
            try:
                pool.putconn(conn)
            except Exception:  # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
class AuditLogMiddleware(BaseHTTPMiddleware):
    """Persist an ``audit_traces`` row for every non-noise request.

    Special paths
    -------------
    * ``/api/audit/approve`` -> also insert an ``approvals`` row.
    * ``/api/audit/export``  -> record the export_type + verdict linkage.
    * ``/api/audit/redact``  -> record field *names* only (DLP/P2).

    The middleware never blocks the request lifecycle. If the DB is
    unavailable, the failure is logged to stderr and the response is
    returned normally.
    """

    def __init__(self, app, *, header_name: str = "x-user-id") -> None:
        super().__init__(app)
        self.header_name = header_name

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        if _should_skip(path):
            return await call_next(request)

        trace_id = str(uuid.uuid4())
        actor = request.headers.get(self.header_name) or "anonymous"
        event_type = _classify_event(path)
        start = time.perf_counter()

        # Read body once, rewind for handlers.
        body_bytes, _content_type = await _read_body_safely(request)
        body_json = _parse_json(body_bytes)

        # Run the actual route handler.
        try:
            response = await call_next(request)
            status_code = response.status_code
            error: Optional[str] = None
        except Exception as exc:  # noqa: BLE001
            status_code = 500
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            latency_ms = int((time.perf_counter() - start) * 1000)
            try:
                self._persist(
                    trace_id=trace_id,
                    path=path,
                    method=request.method,
                    actor=actor,
                    event_type=event_type,
                    body_bytes=body_bytes,
                    body_json=body_json,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    error=error,
                )
            except Exception as exc:  # noqa: BLE001 - never let audit fail the request
                logger.error("AuditLogMiddleware persistence failed: %s", exc, exc_info=True)

        # Expose trace_id to downstream clients for support tickets.
        response.headers["x-trace-id"] = trace_id
        return response

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _persist(
        self,
        *,
        trace_id: str,
        path: str,
        method: str,
        actor: str,
        event_type: str,
        body_bytes: bytes,
        body_json: Optional[dict[str, Any]],
        status_code: int,
        latency_ms: int,
        error: Optional[str],
    ) -> None:
        job_id = None
        verdict: Optional[str] = None
        approver_role: Optional[str] = None
        approver_identity: Optional[str] = None
        approval_state: Optional[str] = None
        export_type: Optional[str] = None
        body_hash = hashlib.sha256(body_bytes or b"").hexdigest()

        # Default payload — always safe to log (no P2).
        payload: dict[str, Any] = {
            "method": method,
            "path": path,
            "status": status_code,
            "latency_ms": latency_ms,
            "body_sha256": body_hash,
        }
        if error:
            payload["error"] = error

        if body_json:
            # job_id is not P2 — safe to log when present.
            job_id = self._safe_str(body_json.get("job_id"))

        # ------------------------------------------------------------------
        # /api/audit/approve
        # ------------------------------------------------------------------
        if path == APPROVE_PATH and body_json is not None:
            event_type = "approve"
            approver_role = self._safe_str(body_json.get("approver_role"))
            approver_identity = self._safe_str(body_json.get("approver_identity"))
            approval_state = self._safe_str(body_json.get("approval_state")) or "pending"
            verdict = self._safe_str(body_json.get("verdict"))
            export_type = self._safe_str(body_json.get("export_type"))
            variance_aed = self._safe_float(body_json.get("variance_aed"))
            comments = self._safe_str(body_json.get("comments"))

            payload["approver_role"] = approver_role
            payload["approver_identity"] = approver_identity
            payload["approval_state"] = approval_state
            payload["verdict"] = verdict
            payload["export_type"] = export_type
            payload["variance_aed"] = variance_aed

            # Insert the approval record (FR-025 requires the linkage).
            # NOTE: we write audit_traces FIRST (below) so the trace row
            # exists by the time any external observer queries approvals
            # joined back to it.

        # ------------------------------------------------------------------
        # /api/audit/export
        # ------------------------------------------------------------------
        elif path == EXPORT_PATH and body_json is not None:
            event_type = "export"
            export_type = self._safe_str(body_json.get("export_type"))
            verdict = self._safe_str(body_json.get("verdict"))
            payload["export_type"] = export_type
            payload["verdict"] = verdict

        # ------------------------------------------------------------------
        # /api/audit/redact
        # ------------------------------------------------------------------
        elif path == REDACT_PATH and body_json is not None:
            event_type = "redact"
            # FR-025 + DLP: log ONLY the names of redacted fields, never values.
            redacted_fields = body_json.get("redacted_fields") or body_json.get("fields") or []
            if not isinstance(redacted_fields, list):
                redacted_fields = []
            payload["redacted_fields"] = [str(f) for f in redacted_fields]
            payload["redaction_count"] = len(payload["redacted_fields"])
            # P2 guarantee: scrub anything else from the body before storing.
            payload.pop("body_sha256", None)
            # Hash the raw body for forensic traceability without storing P2.
            payload["request_body_sha256"] = body_hash

        # Default insert — every request gets an audit_traces row.
        _insert_audit_trace(
            trace_id=trace_id,
            job_id=job_id,
            event_type=event_type,
            actor=actor,
            payload=payload,
            verdict=verdict,
            approver_role=approver_role,
            approver_identity=approver_identity,
            approval_state=approval_state,
            export_type=export_type,
        )

        # Approvals row is inserted AFTER the audit_traces row so the
        # trace_id foreign key is observable by readers.
        if path == APPROVE_PATH and body_json is not None and \
                job_id and approver_role and approver_identity and \
                verdict and approval_state:
            _insert_approval(
                job_id=job_id,
                approval_state=approval_state,
                approver_role=approver_role,
                approver_identity=approver_identity,
                verdict=verdict,
                variance_aed=self._safe_float(body_json.get("variance_aed")),
                comments=self._safe_str(body_json.get("comments")),
                trace_id=trace_id,
            )

    # ------------------------------------------------------------------
    @staticmethod
    def _safe_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            try:
                value = str(value)
            except Exception:  # noqa: BLE001
                return None
        # Cap length to keep audit rows small.
        return value[:256]

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
