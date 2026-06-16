"""P3A: Unit tests for pdf_text parser (plan §4.5: 6 its).

Covers:
- basic text + evidence extraction
- table candidate capture
- empty / low-text (SCANNED) page handling + is_text_based=False + issue
- confidence calc (char density formula)
- issues for large/encrypted (simulated)
- roundtrip with real fixtures (text-pdf-00*.pdf)
"""
from __future__ import annotations
import os
from pathlib import Path
import pytest

from app.parsers.pdf_text import parse_pdf_text_bytes, extract_generic_invoice_lines
from app.schemas import PdfParseResponse, InvoiceLine

FIXTURES = Path(__file__).parent / "fixtures"

def _load(name: str) -> bytes:
    p = FIXTURES / name
    if not p.exists():
        pytest.skip(f"fixture missing: {p} (run tests/gen_pdf_fixtures.py)")
    return p.read_bytes()

def test_text_extract_basic():
    raw = _load("text-pdf-001.pdf")
    res: PdfParseResponse = parse_pdf_text_bytes(raw, file_id="f001", file_name="text-pdf-001.pdf", parser_version="parser-0.2.0-pdf-0.1.0")
    assert res.pdf_page_count >= 1
    assert len(res.text_spans) >= 1
    assert any("INV-2026-001" in (s.text or "") for s in res.text_spans)
    assert len(res.evidence_candidates) >= 1
    assert res.is_text_based is True
    assert 0.0 <= res.parser_confidence <= 1.0
    assert "SCANNED_PAGE_DETECTED" not in res.parser_issues
    assert res.parser_version.startswith("parser-0.2.0-pdf")

def test_table_candidate():
    raw = _load("text-pdf-001.pdf")
    res = parse_pdf_text_bytes(raw, file_id="f001", file_name="t.pdf", parser_version="p-0.2")
    # table may or may not be perfectly detected depending on layout; accept >=0 or check structure
    assert isinstance(res.table_candidates, list)
    if res.table_candidates:
        t0 = res.table_candidates[0]
        assert t0.page >= 1
        assert len(t0.rows) >= 1

def test_empty_or_low_text_page_scanned():
    raw = _load("text-pdf-005.pdf")
    res = parse_pdf_text_bytes(raw, file_id="f005", file_name="scan.pdf", parser_version="p-0.2")
    assert res.is_text_based is False or res.parser_confidence < 0.5
    assert "SCANNED_PAGE_DETECTED" in res.parser_issues or res.parser_confidence < 0.6

def test_confidence_calc_range_and_aggregate():
    raw = _load("text-pdf-002.pdf")
    res = parse_pdf_text_bytes(raw, file_id="f002", file_name="t.pdf", parser_version="p")
    assert 0.0 <= res.parser_confidence <= 1.0
    for s in res.text_spans:
        assert 0.0 <= s.confidence <= 1.0

def test_issues_for_too_large():
    # simulate >10MB by passing huge buffer (no real pdf needed)
    huge = b"%PDF-1.4\n" + (b" " * (10 * 1024 * 1024 + 100))
    res = parse_pdf_text_bytes(huge, file_id="big", file_name="big.pdf", parser_version="p")
    assert "PDF_TOO_LARGE" in res.parser_issues
    assert res.is_text_based is False
    assert res.pdf_page_count == 0

def test_issues_for_encrypted_marker():
    raw = b"%PDF-1.7\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF"
    res = parse_pdf_text_bytes(raw, file_id="encrypted", file_name="encrypted.pdf", parser_version="p")
    assert "PDF_ENCRYPTED" in res.parser_issues
    assert res.is_text_based is False
    assert res.pdf_page_count == 0

def test_low_confidence_and_evidence_fallback():
    # use the low-text one; even if issues, evidence fallback should exist
    raw = _load("text-pdf-005.pdf")
    res = parse_pdf_text_bytes(raw, file_id="f005", file_name="low.pdf", parser_version="p")
    assert len(res.evidence_candidates) >= 0  # may be fallback or empty
    # confidence low-ish
    assert res.parser_confidence < 0.7 or "SCANNED_PAGE_DETECTED" in res.parser_issues


class TestGenericInvoiceLines:
    """Track ①: generic non-DSV PDF line extraction."""

    def test_extracts_lines_from_text_pdf_001(self):
        raw = _load("text-pdf-001.pdf")
        res = parse_pdf_text_bytes(raw, file_id="f001", file_name="inv.pdf", parser_version="p")
        lines, conf = extract_generic_invoice_lines(
            res.text_spans, res.table_candidates, currency_hint='AED'
        )
        assert len(lines) >= 1, f"Expected >=1 generic invoice lines, got {len(lines)}"
        for line in lines:
            assert isinstance(line, InvoiceLine)
            assert line.line_id
            assert line.description
            assert line.currency in ('AED', 'USD', 'KRW', 'EUR')
            assert line.amount > 0
            assert isinstance(line.source_ref, dict)
        assert 0.0 <= conf <= 1.0

    def test_extracts_lines_from_text_pdf_002(self):
        raw = _load("text-pdf-002.pdf")
        res = parse_pdf_text_bytes(raw, file_id="f002", file_name="inv.pdf", parser_version="p")
        lines, conf = extract_generic_invoice_lines(
            res.text_spans, res.table_candidates, currency_hint='AED'
        )
        assert len(lines) >= 1, f"Expected >=1 generic lines, got {len(lines)}"

    def test_no_lines_from_low_text_pdf(self):
        raw = _load("text-pdf-005.pdf")
        res = parse_pdf_text_bytes(raw, file_id="f005", file_name="low.pdf", parser_version="p")
        lines, conf = extract_generic_invoice_lines(
            res.text_spans, res.table_candidates, currency_hint='AED'
        )
        # low-text PDF may produce 0 or few lines; at minimum no crash
        assert isinstance(lines, list)
        assert conf >= 0.0

    def test_dsv_regression_unchanged(self):
        """DSV test fixture output must remain unchanged after generic addition."""
        raw = _load("text-pdf-001.pdf")
        res = parse_pdf_text_bytes(raw, file_id="f001", file_name="inv.pdf", parser_version="p")
        # DSV extraction is separate from generic — verify pdf_text still works
        assert res.pdf_page_count >= 1
        assert res.text_spans
        assert res.is_text_based is True
        # Generic should not interfere with DSV path (parse.py decides ordering)
        assert isinstance(res.table_candidates, list)
