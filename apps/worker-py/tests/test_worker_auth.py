"""Tests for the worker app-token auth gate (WorkerAuthMiddleware)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.middleware.worker_auth import WorkerAuthMiddleware

TOKEN = "s3cr3t-token"


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_middleware(WorkerAuthMiddleware)

    @app.post("/v1/parse")
    def _parse() -> dict:
        return {"ok": True}

    @app.get("/health")
    def _health() -> dict:
        return {"status": "ok"}

    return TestClient(app)


def test_gate_disabled_when_token_unset(client: TestClient, monkeypatch) -> None:
    monkeypatch.delenv("PARSER_WORKER_TOKEN", raising=False)
    r = client.post("/v1/parse")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_missing_header_rejected_when_token_set(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    r = client.post("/v1/parse")
    assert r.status_code == 401
    assert r.json()["detail"] == "WORKER_AUTH_REQUIRED"


def test_wrong_token_rejected(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    r = client.post("/v1/parse", headers={"authorization": "Bearer nope"})
    assert r.status_code == 401


def test_correct_token_allowed(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    r = client.post("/v1/parse", headers={"authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_open_even_when_token_set(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    r = client.get("/health")  # no auth header
    assert r.status_code == 200


def test_options_preflight_allowed_without_auth(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    # OPTIONS must pass the gate so CORS preflight is never blocked.
    r = client.options("/v1/parse")
    assert r.status_code != 401


def test_non_bearer_scheme_rejected(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("PARSER_WORKER_TOKEN", TOKEN)
    r = client.post("/v1/parse", headers={"authorization": f"Basic {TOKEN}"})
    assert r.status_code == 401
