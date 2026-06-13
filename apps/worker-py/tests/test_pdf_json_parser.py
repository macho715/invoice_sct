from __future__ import annotations

import json

import pytest

from app.parsers.pdf_json import parse_pdf_json_bytes
from app.schemas import PdfParseResponse


def _make_json_bytes(pages: list[dict], metadata: dict | None = None) -> bytes:
    doc = {"pages": pages}
    if metadata:
        doc["metadata"] = metadata
    return json.dumps(doc).encode("utf-8")


def test_parse_valid_json_with_spans_and_tables():
    payload = [
        {
            "page_number": 1,
            "spans": [
                {"text": "Invoice INV-2026-001", "bbox": [10, 20, 200, 40], "confidence": 0.95},
                {"text": "BL-ABC-12345", "bbox": [10, 50, 200, 70], "confidence": 0.90},
            ],
            "tables": [
                {
                    "rows": [["Item", "Qty", "Rate"], ["Widget", "10", "100.00"]],
                    "bbox": [10, 100, 400, 300],
                }
            ],
        }
    ]
    data = _make_json_bytes(payload, {"source": "opendataloader", "version": "1.0"})
    res: PdfParseResponse = parse_pdf_json_bytes(data, file_id="f001", file_name="test.json")

    assert res.pdf_page_count == 1
    assert len(res.text_spans) == 2
    assert res.text_spans[0].page == 1
    assert res.text_spans[0].text == "Invoice INV-2026-001"
    assert res.text_spans[0].bbox == (10.0, 20.0, 200.0, 40.0)
    assert res.text_spans[0].confidence == 0.95
    assert len(res.table_candidates) == 1
    assert res.table_candidates[0].page == 1
    assert len(res.table_candidates[0].rows) == 2
    assert res.is_text_based is True
    assert 0.0 <= res.parser_confidence <= 1.0
    assert res.parser_issues == []


def test_malformed_json_returns_issues():
    data = b"{invalid json content"
    res = parse_pdf_json_bytes(data, file_id="f002", file_name="bad.json")

    assert "PDF_JSON_PARSE_FAILED" in res.parser_issues
    assert res.is_text_based is False
    assert res.parser_confidence == 0.0
    assert res.pdf_page_count == 0
    assert res.text_spans == []
    assert res.table_candidates == []


def test_evidence_extraction_bl_do_patterns():
    payload = [
        {
            "page_number": 1,
            "spans": [
                {"text": "Shipment HVDC-ADOPT-XYZ", "bbox": [0, 0, 100, 20], "confidence": 0.9},
                {"text": "DO-DELIVERY-9876 reference", "bbox": [0, 30, 100, 50], "confidence": 0.85},
                {"text": "PO-ORDER-555 attached", "bbox": [0, 60, 100, 80], "confidence": 0.88},
            ],
            "tables": [],
        }
    ]
    data = _make_json_bytes(payload)
    res = parse_pdf_json_bytes(data, file_id="f003", file_name="evidence.json")

    assert len(res.evidence_candidates) >= 1
    matched_refs = [e.matched_reference for e in res.evidence_candidates if e.matched_reference]
    assert any("HVDC" in ref for ref in matched_refs)


def test_confidence_from_span_averages():
    payload = [
        {
            "page_number": 1,
            "spans": [
                {"text": "Line one", "bbox": [0, 0, 100, 20], "confidence": 0.8},
                {"text": "Line two", "bbox": [0, 30, 100, 50], "confidence": 0.6},
            ],
            "tables": [],
        }
    ]
    data = _make_json_bytes(payload)
    res = parse_pdf_json_bytes(data, file_id="f004", file_name="conf.json")

    assert res.parser_confidence == pytest.approx(0.7, abs=0.01)
    assert res.text_spans[0].confidence == 0.8
    assert res.text_spans[1].confidence == 0.6


def test_empty_pages_array():
    data = _make_json_bytes([])
    res = parse_pdf_json_bytes(data, file_id="f005", file_name="empty.json")

    assert res.pdf_page_count == 0
    assert res.text_spans == []
    assert res.table_candidates == []
    assert res.evidence_candidates == []
    assert res.parser_confidence == 0.0
    assert "SCANNED_PAGE_DETECTED" in res.parser_issues
    assert res.is_text_based is False


def test_missing_bbox_and_confidence_defaults():
    payload = [
        {
            "page_number": 1,
            "spans": [
                {"text": "No bbox or confidence here"},
            ],
            "tables": [],
        }
    ]
    data = _make_json_bytes(payload)
    res = parse_pdf_json_bytes(data, file_id="f006", file_name="defaults.json")

    assert len(res.text_spans) == 1
    assert res.text_spans[0].bbox is None
    assert res.text_spans[0].confidence == 0.5
    assert res.is_text_based is True


def test_evidence_fallback_when_no_ref_match():
    payload = [
        {
            "page_number": 1,
            "spans": [
                {"text": "Just some generic text without any reference codes", "bbox": [0, 0, 100, 20], "confidence": 0.9},
            ],
            "tables": [],
        }
    ]
    data = _make_json_bytes(payload)
    res = parse_pdf_json_bytes(data, file_id="f007", file_name="fallback.json")

    assert len(res.evidence_candidates) == 1
    assert res.evidence_candidates[0].matched_reference is None
    assert res.evidence_candidates[0].confidence == 0.25
