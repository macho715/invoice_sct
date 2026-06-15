from __future__ import annotations

import pytest

from app.services.vision_normalizer import normalize_vision_output


def test_normalizes_full_text_annotation_with_references():
    vision_json = {
        "responses": [
            {
                "fullTextAnnotation": {
                    "text": "Invoice No: INV-2026-001\nBL-ABCD1234\nBOE-998877\nTotal: 1,234.50",
                    "pages": [
                        {
                            "blocks": [
                                {
                                    "paragraphs": [
                                        {
                                            "words": [
                                                {"confidence": 0.9},
                                                {"confidence": 0.8},
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                }
            }
        ]
    }

    result = normalize_vision_output(vision_json, file_id="file_vision_1")

    assert result.file_id == "file_vision_1"
    assert result.page_count == 1
    assert "Invoice No: INV-2026-001" in result.full_text
    assert result.confidence == pytest.approx(0.85)

    matched = {e["matched_reference"]: e for e in result.evidence_candidates}
    assert "BL-ABCD1234" in matched
    assert matched["BL-ABCD1234"]["doc_kind"] == "BL"
    assert matched["BL-ABCD1234"]["source_engine"] == "google_vision"
    assert matched["BL-ABCD1234"]["text_span_hash"].startswith("sha256:")
    assert "BOE-998877" in matched


def test_extracts_invoice_number_and_total():
    vision_json = {
        "responses": [
            {
                "text": "Supplier: Synthetic Logistics\nInvoice Number INV-2026-777\nAmount Due: 12,345.67"
            }
        ]
    }

    result = normalize_vision_output(vision_json, file_id="file_invoice")

    assert result.invoice_no == "INV-2026-777"
    assert result.invoice_total == pytest.approx(12345.67)


def test_averages_word_confidence():
    vision_json = {
        "responses": [
            {
                "fullTextAnnotation": {
                    "text": "BL-ABCD9999",
                    "pages": [
                        {
                            "blocks": [
                                {
                                    "paragraphs": [
                                        {
                                            "words": [
                                                {"confidence": 0.95},
                                                {"confidence": 0.75},
                                                {"confidence": 0.50},
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                }
            }
        ]
    }

    result = normalize_vision_output(vision_json, file_id="file_conf")

    assert result.confidence == pytest.approx((0.95 + 0.75 + 0.50) / 3)


def test_empty_ocr_output_reports_low_confidence_and_scanned_issue():
    result = normalize_vision_output({"responses": []}, file_id="file_empty")

    assert result.page_count == 0
    assert result.full_text == ""
    assert result.confidence == 0.0
    assert result.evidence_candidates == []
    assert "VISION_LOW_CONFIDENCE" in result.issues
    assert "SCANNED_PAGE_DETECTED" in result.issues


def test_uses_text_length_confidence_fallback():
    synthetic_text = "A" * 250
    vision_json = {"responses": [{"text": synthetic_text}]}

    result = normalize_vision_output(vision_json, file_id="file_fallback")

    assert result.page_count == 1
    assert result.full_text == synthetic_text
    assert result.confidence == pytest.approx(0.5)
    assert result.issues == []

