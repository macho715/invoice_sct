from __future__ import annotations

import pytest

from app.services.v_vision_rules import (
    extract_context_amounts,
    parse_vision_text,
)


def _vision_fixture(*pages: str) -> str:
    """Synthetic text shaped like Google Vision fullTextAnnotation output."""
    return "\n\f\n".join(pages)


def _issue_codes(result) -> set[str]:
    return {issue["code"] for issue in result.issues}


def test_rhs_carrier_invoice_extracts_doc_type_and_line_items():
    text = _vision_fixture(
        """
        RAIS HASSAN SAADI
        TAX INVOICE
        Shipment Ref HVDC-ADOPT-SCT-0123
        Invoice No: IN12345678
        1 Container Inspection Fee AED 130.00 6.50 136.50
        """
    )

    result = parse_vision_text(text, file_id="file_rhs", file_name="HVDC-ADOPT-SCT-0123.pdf", confidence=0.92)

    assert result.doc_type == "CARRIER_RHS"
    assert result.parser_verdict == "PASS"
    assert result.type_b == "Inspection"
    assert result.keys["shipment_no"] == "HVDC-ADOPT-SCT-0123"
    assert result.keys["invoice_no"] == "IN12345678"
    assert result.line_items[0]["description"] == "Container Inspection Fee"
    assert result.line_items[0]["total_aed"] == pytest.approx(136.50)
    assert any(candidate["matched_reference"] == "HVDC-ADOPT-SCT-0123" for candidate in result.evidence_candidates)


def test_allied_inspection_extracts_container_and_total():
    text = _vision_fixture(
        """
        ALLIED ONDOCK CONTAINER SERVICES
        HVDC-ADOPT-SCT-0456
        Being Admin & Inspection Charges HMMU6089377 AED 25.00 AED 1.25 AED 26.25
        """
    )

    result = parse_vision_text(text, file_id="file_allied", confidence=0.88)

    assert result.doc_type == "PORT_ALLIED"
    assert result.evidence_status == "MATCHED_AMOUNT"
    assert result.type_b == "Inspection"
    assert "HMMU6089377" in result.keys["containers"]
    assert result.line_items[0]["container"] == "HMMU6089377"
    assert result.line_items[0]["total_aed"] == pytest.approx(26.25)


def test_boe_customs_stays_amber_with_debit_line():
    text = _vision_fixture(
        """
        CUSTOMS DECLARATION
        DEBIT NOTE
        12345678
        Shipment HVDC-ADOPT-HE-0425
        Import 33929 101,180
        15-JUN-2026
        """
    )

    result = parse_vision_text(text, file_id="file_boe", confidence=0.91)

    assert result.doc_type == "BOE_CUSTOMS"
    assert result.type_b == "Customs"
    assert result.parser_verdict == "AMBER"
    assert "CUSTOMS_FINAL_REVIEW_REQUIRED" in _issue_codes(result)
    assert result.line_items[0]["description"] == "Pre-Clear Debit"
    assert result.line_items[0]["amount_aed"] == pytest.approx(101180.0)


def test_delivery_order_extracts_do_number_without_amount_required():
    text = _vision_fixture(
        """
        DELIVERY ORDER
        D.O. NUMBER DOCHP12345678
        Shipment HVDC-ADOPT-SCT-0124
        Validity Date 2026-06-15
        """
    )

    result = parse_vision_text(text, file_id="file_do", confidence=0.86)

    assert result.doc_type == "DELIVERY_ORDER"
    assert result.keys["do_no"] == "DOCHP12345678"
    assert result.evidence_status == "NOT_APPLICABLE"
    assert result.parser_verdict == "PASS"
    assert result.type_b == "DO"


def test_bank_and_trn_amount_lines_are_excluded_from_context_amounts():
    text = _vision_fixture(
        """
        BANK ACCOUNT AED 999,999.00
        TRN: 100000000000 AED 888,888.00
        Service Fee AED 75.00
        TOTAL AMOUNT AED 75.00
        """
    )

    assert extract_context_amounts(text) == [75.0]


def test_unknown_low_confidence_is_amber():
    text = _vision_fixture("Unreadable OCR fragment with no DSV header")

    result = parse_vision_text(text, file_id="file_unknown", confidence=0.4)

    assert result.doc_type == "UNKNOWN"
    assert result.parser_verdict == "AMBER"
    assert {"UNKNOWN_DOCTYPE", "VISION_LOW_CONFIDENCE", "LOW_TEXT_LENGTH"}.issubset(_issue_codes(result))
