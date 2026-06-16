# apps/worker-py/tests/test_health.py
"""Health check endpoint tests.

Three scenarios are required by the spec:

1. ``GET /health/live`` always returns 200.
2. ``GET /health/ready`` with a healthy DB returns 200 and the full checks
   envelope.
3. ``GET /health/ready`` with a failing DB returns 503.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_health_live_always_200(client: TestClient) -> None:
    """Liveness probe must always return 200, even if other systems are down."""
    r = client.get("/health/live")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert "timestamp" in body


def test_health_ready_with_mocked_db_success(client: TestClient) -> None:
    """When the DB check passes, /health/ready returns 200 with all checks."""

    async def fake_db_ok() -> dict:
        return {"ok": True, "latency_ms": 5}

    async def fake_blob_ok() -> dict:
        return {"ok": True, "latency_ms": 3}

    async def fake_parsers_ok() -> dict:
        return {
            "ok": True,
            "latency_ms": 1,
            "parsers": ["xlsx", "pdf_text", "pdf_json"],
            "missing": [],
        }

    async def fake_memory_ok() -> dict:
        return {"ok": True, "latency_ms": 1, "rss_mb": 128}

    with patch("app.routes.health._check_db", side_effect=fake_db_ok), \
         patch("app.routes.health._check_blob", side_effect=fake_blob_ok), \
         patch("app.routes.health._check_parsers", side_effect=fake_parsers_ok), \
         patch("app.routes.health._check_memory", side_effect=fake_memory_ok):
        r = client.get("/health/ready")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"
    assert "checks" in body
    checks = body["checks"]
    assert checks["db"]["ok"] is True
    assert "latency_ms" in checks["db"]
    assert checks["blob_storage"]["ok"] is True
    assert "latency_ms" in checks["blob_storage"]
    assert checks["parsers"]["ok"] is True
    assert set(checks["parsers"]["parsers"]) == {"xlsx", "pdf_text", "pdf_json"}
    assert checks["memory"]["ok"] is True
    assert "rss_mb" in checks["memory"]
    assert "timestamp" in body


def test_health_ready_with_db_failure_returns_503(client: TestClient) -> None:
    """If the DB check fails, the overall status is unhealthy/degraded → 503."""

    async def fake_db_fail() -> dict:
        return {"ok": False, "latency_ms": 0, "error": "simulated outage"}

    async def fake_blob_ok() -> dict:
        return {"ok": True, "latency_ms": 3}

    async def fake_parsers_ok() -> dict:
        return {
            "ok": True,
            "latency_ms": 1,
            "parsers": ["xlsx", "pdf_text", "pdf_json"],
            "missing": [],
        }

    async def fake_memory_ok() -> dict:
        return {"ok": True, "latency_ms": 1, "rss_mb": 128}

    with patch("app.routes.health._check_db", side_effect=fake_db_fail), \
         patch("app.routes.health._check_blob", side_effect=fake_blob_ok), \
         patch("app.routes.health._check_parsers", side_effect=fake_parsers_ok), \
         patch("app.routes.health._check_memory", side_effect=fake_memory_ok):
        r = client.get("/health/ready")

    assert r.status_code == 503, r.text
    body = r.json()
    assert body["status"] in {"unhealthy", "degraded"}
    assert body["checks"]["db"]["ok"] is False
    assert "error" in body["checks"]["db"]
    # Other checks should still be reported.
    assert body["checks"]["blob_storage"]["ok"] is True
    assert body["checks"]["parsers"]["ok"] is True
    assert body["checks"]["memory"]["ok"] is True


def test_health_ready_with_db_skipped_when_url_unset(client: TestClient) -> None:
    """When DATABASE_URL is unset, DB check returns skipped (200, not 503)."""

    async def fake_db_skip() -> dict:
        return {"ok": True, "latency_ms": 0, "skipped": True, "reason": "DATABASE_URL unset; audit logging disabled (optional)"}

    async def fake_blob_ok() -> dict:
        return {"ok": True, "latency_ms": 3}

    async def fake_parsers_ok() -> dict:
        return {
            "ok": True,
            "latency_ms": 1,
            "parsers": ["xlsx", "pdf_text", "pdf_json"],
            "missing": [],
        }

    async def fake_memory_ok() -> dict:
        return {"ok": True, "latency_ms": 1, "rss_mb": 128}

    with patch("app.routes.health._check_db", side_effect=fake_db_skip), \
         patch("app.routes.health._check_blob", side_effect=fake_blob_ok), \
         patch("app.routes.health._check_parsers", side_effect=fake_parsers_ok), \
         patch("app.routes.health._check_memory", side_effect=fake_memory_ok):
        r = client.get("/health/ready")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    checks = body["checks"]
    assert checks["db"]["ok"] is True
    assert checks["db"]["skipped"] is True
    assert "reason" in checks["db"]
    assert checks["blob_storage"]["ok"] is True
