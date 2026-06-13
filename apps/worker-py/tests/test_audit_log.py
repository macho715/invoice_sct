"""Tests for app.middleware.audit_log (FR-025 compliance).

Coverage:
1. Parse event logging — basic audit_traces insert.
2. Approve event — approver_role / approver_identity / approval_state /
   verdict / variance_aed / export_type extracted AND an ``approvals`` row
   is inserted.
3. Redact event — only field NAMES are logged; P2 values are never
   persisted.
4. DB unavailable — request still completes (fail-soft).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Ensure project root is on sys.path (mirrors conftest.py).
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import db  # noqa: E402
from app.middleware.audit_log import AuditLogMiddleware  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _build_app() -> FastAPI:
    """Build a minimal FastAPI app wired with the audit middleware and a few
    fake routes that exercise the middleware's classification logic."""
    from fastapi import APIRouter

    app = FastAPI()
    app.add_middleware(AuditLogMiddleware)

    # Routes matching the FR-025 event taxonomy.
    app.add_api_route("/parse", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/validate", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/upload", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/api/audit/approve", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/api/audit/export", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/api/audit/redact", lambda: {"ok": True}, methods=["POST"])
    app.add_api_route("/api/audit/other", lambda: {"ok": True}, methods=["POST"])

    # Health-like noise that should be skipped.
    health = APIRouter()
    health.add_api_route("/health", lambda: {"status": "ok"}, methods=["GET"])
    app.include_router(health)
    return app


@pytest.fixture(autouse=True)
def _reset_pool_state(monkeypatch):
    """Reset module-level DB pool state between tests and inject a
    thread-safe fake pool that records all queries."""
    db.reset_pool()
    fake = db._NullPool()
    monkeypatch.setattr(db, "_build_pool", lambda: fake)
    monkeypatch.setattr(db, "get_pool", lambda: fake)
    yield fake
    db.reset_pool()


# ---------------------------------------------------------------------------
# 1. Parse event logging
# ---------------------------------------------------------------------------
def test_parse_event_logs_to_audit_traces(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())

    resp = client.post(
        "/parse",
        json={"job_id": "job-123", "blob_url": "https://example.com/x.pdf"},
        headers={"x-user-id": "scm-001"},
    )

    assert resp.status_code == 200
    # trace_id header is exposed for support tickets.
    assert "x-trace-id" in resp.headers

    # An audit_traces row was inserted.
    assert len(fake.queries) == 1
    sql, params = fake.queries[0]
    assert "INSERT INTO audit_traces" in sql
    # event_type is parameterized, not inlined, so check the params tuple.
    # Layout: (trace_id, job_id, event_type, actor, verdict, approver_role,
    #          approver_identity, approval_state, export_type, payload)
    trace_id, job_id, event_type, actor, verdict, approver_role, \
        approver_identity, approval_state, export_type, payload = params

    assert trace_id == resp.headers["x-trace-id"]
    assert job_id == "job-123"
    assert event_type == "parse"
    assert actor == "scm-001"
    assert verdict is None
    assert approver_role is None
    assert approver_identity is None
    assert approval_state is None
    assert export_type is None

    payload_dict = json.loads(payload)
    assert payload_dict["method"] == "POST"
    assert payload_dict["path"] == "/parse"
    assert payload_dict["status"] == 200
    assert "latency_ms" in payload_dict
    assert "body_sha256" in payload_dict


def test_parse_event_anonymous_actor_when_header_missing(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())
    client.post("/parse", json={"job_id": "job-1"})
    sql, params = fake.queries[0]
    assert "INSERT INTO audit_traces" in sql
    trace_id, job_id, event_type, actor, verdict, approver_role, \
        approver_identity, approval_state, export_type, payload = params
    assert actor == "anonymous"


# ---------------------------------------------------------------------------
# 2. Approve event — full FR-025 extraction
# ---------------------------------------------------------------------------
def test_approve_event_extracts_fr025_fields(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())

    body = {
        "job_id": "job-9001",
        "approver_role": "Finance Manager",
        "approver_identity": "kim.scn",
        "approval_state": "approved",
        "verdict": "AMBER",
        "variance_aed": 1234.56,
        "export_type": "final_approved",
        "comments": "Reviewed by Finance",
    }
    resp = client.post(
        "/api/audit/approve",
        json=body,
        headers={"x-user-id": "kim.scn"},
    )
    assert resp.status_code == 200

    # Two queries: audit_traces + approvals.
    assert len(fake.queries) == 2
    trace_sql, trace_params = fake.queries[0]
    approval_sql, approval_params = fake.queries[1]

    assert "INSERT INTO audit_traces" in trace_sql
    assert "INSERT INTO approvals" in approval_sql

    # audit_traces columns include the FR-025 fields.
    trace_id, job_id, event_type, actor, verdict, approver_role, \
        approver_identity, approval_state, export_type, payload = trace_params
    assert event_type == "approve"
    assert actor == "kim.scn"
    assert job_id == "job-9001"
    assert verdict == "AMBER"
    assert approver_role == "Finance Manager"
    assert approver_identity == "kim.scn"
    assert approval_state == "approved"
    assert export_type == "final_approved"
    payload_dict = json.loads(payload)
    assert payload_dict["verdict"] == "AMBER"
    assert payload_dict["variance_aed"] == 1234.56

    # approvals row contains the linkage.
    a_job_id, a_state, a_role, a_identity, a_verdict, a_variance, a_comments, a_trace_id = approval_params
    assert a_job_id == "job-9001"
    assert a_state == "approved"
    assert a_role == "Finance Manager"
    assert a_identity == "kim.scn"
    assert a_verdict == "AMBER"
    assert a_variance == 1234.56
    assert a_comments == "Reviewed by Finance"
    assert a_trace_id == trace_id


def test_export_event_records_export_type_and_verdict(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())
    resp = client.post(
        "/api/audit/export",
        json={"job_id": "job-2", "export_type": "review_pack", "verdict": "ZERO"},
        headers={"x-user-id": "ops.lead"},
    )
    assert resp.status_code == 200
    assert len(fake.queries) == 1
    _, params = fake.queries[0]
    trace_id, job_id, event_type, actor, verdict, approver_role, \
        approver_identity, approval_state, export_type, payload = params
    assert event_type == "export"
    assert job_id == "job-2"
    assert verdict == "ZERO"
    assert export_type == "review_pack"
    payload_dict = json.loads(payload)
    assert payload_dict["export_type"] == "review_pack"
    assert payload_dict["verdict"] == "ZERO"


# ---------------------------------------------------------------------------
# 3. Redact event — P2 values must NEVER be logged
# ---------------------------------------------------------------------------
def test_redact_event_logs_field_names_only(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())

    secret_value = "[REDACTED-TRN]1234567890"
    body = {
        "job_id": "job-3",
        "redacted_fields": ["vendor_email", "trn", "rate"],
        # These P2 values MUST NOT appear in audit row payload.
        "vendor_email": secret_value,
        "trn": "100123456789003",
        "rate": 1500.00,
    }
    resp = client.post(
        "/api/audit/redact",
        json=body,
        headers={"x-user-id": "scm-anon"},
    )
    assert resp.status_code == 200
    assert len(fake.queries) == 1

    _, params = fake.queries[0]
    trace_id, job_id, event_type, actor, verdict, approver_role, \
        approver_identity, approval_state, export_type, payload = params
    assert event_type == "redact"
    payload_dict = json.loads(payload)

    # Field NAMES are logged.
    assert payload_dict["redacted_fields"] == ["vendor_email", "trn", "rate"]
    assert payload_dict["redaction_count"] == 3
    # P2 values are NOT logged — neither as top-level keys nor nested.
    serialized = json.dumps(payload_dict)
    assert secret_value not in serialized
    assert "100123456789003" not in serialized
    assert "1500" not in serialized
    # Field NAMES are intentionally present in the redacted_fields list —
    # that is the audit record. We only assert that no raw P2 value
    # slipped through.
    # Only the request body hash is preserved for forensic traceability.
    assert "request_body_sha256" in payload_dict
    # And the body_sha256 that the general path stores is NOT in payload
    # (the redact path replaces it with request_body_sha256).
    assert "body_sha256" not in payload_dict


# ---------------------------------------------------------------------------
# 4. Fail-soft: DB unavailable must not block the request
# ---------------------------------------------------------------------------
def test_request_succeeds_when_db_unavailable(monkeypatch):
    # Force db.get_pool to return None — simulates no DATABASE_URL or outage.
    monkeypatch.setattr(db, "get_pool", lambda: None)
    db.reset_pool()

    app = FastAPI()
    app.add_middleware(AuditLogMiddleware)
    app.add_api_route("/parse", lambda: {"ok": True}, methods=["POST"])

    client = TestClient(app)
    resp = client.post("/parse", json={"job_id": "job-x"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    # trace_id header is still attached even though no row was written.
    assert "x-trace-id" in resp.headers


def test_request_succeeds_when_db_pool_raises(monkeypatch, caplog):
    """Even if the pool itself throws on getconn(), the request must pass."""

    class _BrokenPool:
        def getconn(self):
            raise RuntimeError("simulated DB outage")

        def putconn(self, _conn):  # pragma: no cover
            return None

        def closeall(self):  # pragma: no cover
            return None

    monkeypatch.setattr(db, "get_pool", lambda: _BrokenPool())
    db.reset_pool()

    app = FastAPI()
    app.add_middleware(AuditLogMiddleware)
    app.add_api_route("/validate", lambda: {"ok": True}, methods=["POST"])

    with caplog.at_level("ERROR", logger="app.middleware.audit_log"):
        client = TestClient(app)
        resp = client.post("/validate", json={"job_id": "job-y"})

    assert resp.status_code == 200
    # The error was logged but did not propagate.
    assert any("insert failed" in rec.message for rec in caplog.records)


# ---------------------------------------------------------------------------
# Misc. coverage: classification + noise skipping
# ---------------------------------------------------------------------------
def test_event_type_classification():
    from app.middleware.audit_log import _classify_event
    assert _classify_event("/parse") == "parse"
    assert _classify_event("/v1/validate") == "validate"
    assert _classify_event("/api/audit/approve") == "approve"
    assert _classify_event("/v1/export") == "export"
    assert _classify_event("/api/audit/redact") == "redact"
    assert _classify_event("/upload/file") == "upload"
    assert _classify_event("/something-else") == "other"


def test_health_endpoint_is_skipped(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    # No audit row written for health checks.
    assert len(fake.queries) == 0


def test_trace_id_is_unique_per_request(_reset_pool_state):
    fake = _reset_pool_state
    client = TestClient(_build_app())
    ids = set()
    for _ in range(3):
        r = client.post("/parse", json={"job_id": "j"})
        ids.add(r.headers["x-trace-id"])
    assert len(ids) == 3
    # Three audit rows.
    assert len(fake.queries) == 3
