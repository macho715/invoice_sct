"""Tests for the DSV SHPT hybrid PDF line-item extractor (synthetic text only).

Cases mirror docs/dsv shpt pdf.md §14 and the v2.1 golden behaviour
(pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final). No real customer documents.
"""
from __future__ import annotations

from app.parsers.dsv_pdf_hybrid import (
    classify_doc,
    extract_common_keys,
    extract_dsv_from_text,
    extract_line_items,
    iso6346_valid,
    map_type_b,
)


# ---------------------------------------------------------------------------
# DOC_TYPE classification
# ---------------------------------------------------------------------------

def test_classify_carrier_rhs():
    txt = "RAIS HASSAN SAADI\nTAX INVOICE\nHVDC-ADOPT-SCT-0175"
    assert classify_doc(txt, "x.pdf")["doc_type"] == "CARRIER_RHS"


def test_classify_port_allied_twcs():
    txt = "TWCS INSPECTION\nBeing Admin & Inspection Charges"
    assert classify_doc(txt, "x.pdf")["doc_type"] == "PORT_ALLIED"


def test_classify_boe_customs_before_delivery_order():
    # BOE contains the label DELIVERY ORDER NO but must classify as customs.
    txt = "CUSTOMS DECLARATION\nDEBIT NOTE\nDELIVERY ORDER NO: 12345678"
    assert classify_doc(txt, "x.pdf")["doc_type"] == "BOE_CUSTOMS"


def test_classify_delivery_order():
    txt = "DELIVERY ORDER\nD.O. NUMBER: DOCHP12345678"
    assert classify_doc(txt, "x.pdf")["doc_type"] == "DELIVERY_ORDER"


def test_classify_airport_fees():
    txt = "CHARGES SUMMARY\nMAQTA CHARGES\nDPC CHARGES"
    assert classify_doc(txt, "x.pdf")["doc_type"] == "AIRPORT_FEES"


def test_classify_unknown():
    assert classify_doc("random text with no fingerprint", "x.pdf")["doc_type"] == "UNKNOWN"


# ---------------------------------------------------------------------------
# COMMON_KEYS extraction
# ---------------------------------------------------------------------------

def test_extract_shipment_from_text_and_filename():
    keys = extract_common_keys("Ref HVDC-ADOPT-SCT-0175 cargo", "HVDC-ADOPT-HE-0523_SuppDocs.pdf")
    assert "HVDC-ADOPT-SCT-0175" in keys["shipment_nos"]
    assert "HVDC-ADOPT-HE-0523" in keys["shipment_nos"]


def test_iso6346_validation():
    assert iso6346_valid("HMMU6089377") is True
    assert iso6346_valid("HMMU6089370") is False  # wrong check digit
    assert iso6346_valid("NOTACONTAINER") is False


def test_amount_excludes_bank_trn_lines():
    txt = (
        "Appointment Charges AED 27.00\n"
        "Bank IBAN AED 999999.00\n"
        "TRN: 100123456700003 AED 123456.00\n"
    )
    amounts = extract_common_keys(txt, "x.pdf")["amounts_aed"]
    assert 27.0 in amounts
    assert 999999.0 not in amounts
    assert 123456.0 not in amounts


# ---------------------------------------------------------------------------
# Line item extraction
# ---------------------------------------------------------------------------

def test_carrier_rhs_line_extraction():
    txt = (
        "RAIS HASSAN SAADI\nTAX INVOICE\nHVDC-ADOPT-SCT-0175\n"
        "1 Container Inspection AED 100.00 5.00 105.00"
    )
    items = extract_line_items(txt, [], "CARRIER_RHS")
    assert len(items) == 1
    li = items[0]
    assert li.amount_aed == 100.00
    assert li.total_aed == 105.00
    assert li.type_b == "Inspection"
    assert li.evidence_status == "MATCHED_AMOUNT"


def test_airport_fee_line_extraction():
    txt = "CHARGES SUMMARY\nMAQTA CHARGES\nAppointment Charges 1 27.00 27.00"
    items = extract_line_items(txt, [], "AIRPORT_FEES")
    descs = [i.description for i in items]
    assert any("Appointment" in d for d in descs)
    assert any(i.total_aed == 27.00 for i in items)


def test_allied_inspection_text_pattern():
    txt = (
        "TWCS INSPECTION\n"
        "Being Admin & Inspection Charges HMMU6089377 "
        "AED 200.00 AED 10.00 AED 210.00"
    )
    items = extract_line_items(txt, [], "PORT_ALLIED")
    assert any(i.container == "HMMU6089377" and i.total_aed == 210.00 for i in items)


def test_allied_table_line_extraction():
    tables = [{
        "page": 7,
        "table_index": 0,
        "rows": [
            ["No", "Description/Container No", "Amount", "VAT", "Total"],
            ["1", "Inspection HMMU6089377", "200.00", "10.00", "210.00"],
        ],
    }]
    items = extract_line_items("", tables, "PORT_ALLIED")
    assert len(items) == 1
    assert items[0].total_aed == 210.00
    assert items[0].container == "HMMU6089377"


def test_duplicate_amount_not_false_matched_across_docs():
    # Same AED amount must not produce duplicate line items (§22 dedupe).
    txt = (
        "RAIS HASSAN SAADI\nTAX INVOICE\n"
        "1 Container Inspection AED 100.00 0.00 100.00\n"
        "1 Container Inspection AED 100.00 0.00 100.00"
    )
    items = extract_line_items(txt, [], "CARRIER_RHS")
    assert len(items) == 1  # deduped


# ---------------------------------------------------------------------------
# Integration: extract_dsv_from_text
# ---------------------------------------------------------------------------

def test_extract_dsv_from_text_full():
    txt = (
        "RAIS HASSAN SAADI\nTAX INVOICE\nHVDC-ADOPT-SCT-0175\n"
        "1 Container Inspection AED 100.00 5.00 105.00"
    )
    r = extract_dsv_from_text(txt, [], file_name="HVDC-ADOPT-SCT-0175_SuppDocs.pdf")
    assert r.doc_type == "CARRIER_RHS"
    assert r.keys["shipment_no"] == "HVDC-ADOPT-SCT-0175"
    assert len(r.line_items) >= 1
    assert r.type_b == "Inspection"
    assert r.evidence_status == "MATCHED_AMOUNT"


def test_extract_dsv_low_text_no_lines():
    # Sparse text with no doc fingerprint / no charges -> UNKNOWN, no lines, MISSING.
    r = extract_dsv_from_text("page 1 of 2", [], file_name="scan.pdf")
    assert r.doc_type == "UNKNOWN"
    assert r.line_items == []
    assert r.evidence_status == "MISSING"


def test_type_b_fallback_by_doc_type():
    assert map_type_b("no keywords here", "DELIVERY_ORDER") == "DO"
    assert map_type_b("no keywords here", "BOE_CUSTOMS") == "Customs"
