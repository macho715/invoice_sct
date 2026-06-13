"""Patch #3: pdf_json route dispatch tests."""
import json
from fastapi.testclient import TestClient
from app.main import create_app


def _valid_pdf_json_bytes() -> bytes:
    doc = {
        "pages": [
            {
                "page_number": 1,
                "spans": [
                    {"text": "Invoice INV-TEST-001", "confidence": 0.92},
                    {"text": "Total: 1500.00 AED", "confidence": 0.88},
                ],
                "tables": [],
            }
        ]
    }
    return json.dumps(doc).encode("utf-8")


def test_parse_pdf_json_valid(monkeypatch):
    from app.routes import parse as parse_route
    monkeypatch.setattr(parse_route, "_fetch_blob", lambda url: _valid_pdf_json_bytes())
    app = create_app()
    c = TestClient(app)

    r = c.post("/parse", json={
        "blob_ref": "blob:job_pj/f-pj",
        "file_id": "f-pj",
        "job_id": "job_pj",
        "file_type": "pdf_json",
        "parser_version": "parser-0.2.0-pdf-json-0.1.0",
        "blob_url": "http://signed/pdf-json-001",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_id"] == "f-pj"
    assert body["normalized"]["parser_confidence"] > 0.0
    assert len(body["source_data"]) == 2
    assert body["source_data"][0]["routing_pattern"] == "PDF_JSON_SPAN"


def test_parse_pdf_json_invalid_json(monkeypatch):
    from app.routes import parse as parse_route
    monkeypatch.setattr(parse_route, "_fetch_blob", lambda url: b"NOT VALID JSON {{{")
    app = create_app()
    c = TestClient(app)

    r = c.post("/parse", json={
        "blob_ref": "blob:job_pj2/f-pj2",
        "file_id": "f-pj2",
        "job_id": "job_pj2",
        "file_type": "pdf_json",
        "parser_version": "parser-0.2.0-pdf-json-0.1.0",
        "blob_url": "http://signed/pdf-json-bad",
    })
    assert r.status_code == 422
    assert r.json()["detail"] == "PARSE_PDF_JSON_FAILED"


def test_parse_pdf_json_convenience_route(monkeypatch):
    from app.routes import parse as parse_route
    monkeypatch.setattr(parse_route, "_fetch_blob", lambda url: _valid_pdf_json_bytes())
    app = create_app()
    c = TestClient(app)

    r = c.post("/parse/pdf-json", json={
        "blob_ref": "blob:job_pj3/f-pj3",
        "file_id": "f-pj3",
        "job_id": "job_pj3",
        "file_type": "pdf",
        "parser_version": "parser-0.2.0-pdf-json-0.1.0",
        "blob_url": "http://signed/pdf-json-conv",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_data"][0]["routing_pattern"] == "PDF_JSON_SPAN"
