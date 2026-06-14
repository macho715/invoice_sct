import pytest
from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


class TestNotebookLmRoute:
    def test_route_exists(self):
        """POST /v1/notebooklm/run is registered."""
        response = client.post("/v1/notebooklm/run", json={
            "job_id": "test_job",
            "blob_url": "http://test/blob.pdf",
        })
        # May return 500 (orchestrator fails in test env) but route exists
        assert response.status_code in (200, 202, 500)

    def test_validates_required_fields(self):
        response = client.post("/v1/notebooklm/run", json={"job_id": ""})
        assert response.status_code == 422

    def test_returns_stable_response_shape(self):
        response = client.post("/v1/notebooklm/run", json={
            "job_id": "test_job",
            "blob_url": "http://test/blob.pdf",
        })
        body = response.json()
        # Even on failure, must have these fields
        assert "job_id" in body
        assert "status" in body
        assert body["job_id"] == "test_job"
