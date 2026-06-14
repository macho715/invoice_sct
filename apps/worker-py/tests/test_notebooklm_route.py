import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch

from app.main import app


client = TestClient(app)


class TestNotebookLmRoute:
    def test_route_returns_stable_unavailable_when_env_missing(self, monkeypatch):
        """POST /v1/notebooklm/run is registered and returns a stable failure body."""
        monkeypatch.delenv("MARKITDOWN_MCP_URL", raising=False)
        monkeypatch.delenv("NOTEBOOKLM_MCP_URL", raising=False)
        monkeypatch.delenv("WEB_CALLBACK_URL", raising=False)
        monkeypatch.delenv("NOTEBOOKLM_CALLBACK_SECRET", raising=False)

        response = client.post("/v1/notebooklm/run", json={
            "job_id": "test_job",
            "blob_url": "http://test/blob.pdf",
        })

        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] == "test_job"
        assert body["status"] == "NOTEBOOKLM_UNAVAILABLE"
        assert body["error_code"] == "MARKITDOWN_MCP_URL_NOT_SET"

    def test_validates_required_fields(self):
        response = client.post("/v1/notebooklm/run", json={"job_id": ""})
        assert response.status_code == 422

    def test_returns_success_response_shape(self):
        result = {
            "status": "CALLBACK_SENT",
            "notebooklm_source_id": "src_1",
            "markdown_sha256": "a" * 64,
            "source_sha256": "b" * 64,
            "callback_status": 202,
        }
        fake_orchestrator = MagicMock()
        fake_orchestrator.run = AsyncMock(return_value=result)

        with patch("app.routes.notebooklm.NotebookLmOrchestrator", return_value=fake_orchestrator):
            response = client.post("/v1/notebooklm/run", json={
                "job_id": "test_job",
                "blob_url": "http://test/blob.pdf",
                "notebook_id": "nb_1",
            })

        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] == "test_job"
        assert body["status"] == "CALLBACK_SENT"
        assert body["notebooklm_source_id"] == "src_1"
        assert body["markdown_sha256"] == "a" * 64
        assert body["source_sha256"] == "b" * 64
        assert body["callback_status"] == 202
        fake_orchestrator.run.assert_awaited_once_with(
            job_id="test_job",
            blob_url="http://test/blob.pdf",
            notebook_id="nb_1",
        )
