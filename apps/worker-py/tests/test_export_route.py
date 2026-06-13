from fastapi.testclient import TestClient
from app.main import create_app
import base64

def test_export_route_success():
    app = create_app()
    c = TestClient(app)
    payload = {
        "job_id": "job_123",
        "generated_at": "2026-06-09T12:00:00Z",
        "decision_rows": [
            {
                "job_id": "job_123",
                "verdict": "PASS",
                "rule_version": "r1",
                "parser_version": "p1",
                "zero_count": 0,
                "amber_count": 0
            }
        ],
        "action_items_rows": [],
        "final_recon_rows": [],
        "line_view_rows": [],
        "source_data_rows": [],
        "audit_detail_rows": [],
        "evidence_issues_rows": []
    }
    r = c.post('/v1/export', json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["job_id"] == "job_123"
    assert "manifest" in data
    assert "file_content_base64" in data
    
    # Verify we can decode base64
    xlsx_bytes = base64.b64decode(data["file_content_base64"])
    assert len(xlsx_bytes) > 0
    assert data["manifest"]["sha256"] is not None
    assert data["manifest"]["size_bytes"] == len(xlsx_bytes)
    assert data["manifest"]["generated_at"] == "2026-06-09T12:00:00Z"
    
    sheets = {s["sheet_name"]: s["row_count"] for s in data["manifest"]["sheets"]}
    assert sheets["00_Decision"] == 1
    assert sheets["01_Action_Items"] == 0

def test_export_route_invalid_payload():
    app = create_app()
    c = TestClient(app)
    # Missing required field decision_rows
    payload = {
        "job_id": "job_123"
    }
    r = c.post('/v1/export', json=payload)
    assert r.status_code == 422
