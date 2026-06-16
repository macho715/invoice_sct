"""P3A PDF text parser using pdfplumber (plan §4).

Extracts text spans + table candidates from text-based PDFs for invoice/audit.
- Confidence: per-page char density (min(1, chars/500)), aggregate mean.
- Issues: SCANNED_PAGE_DETECTED (no text), PDF_ENCRYPTED, PDF_TOO_LARGE, PARSE_FAILED.
- Evidence candidates populated from text (ref patterns) + spans.
- Returns PdfParseResponse; route adapts to NormalizedInvoice for now (merge/enhance in P3B web).
"""
from __future__ import annotations

import json
import re
from io import BytesIO
from statistics import mean
from typing import Optional, Dict, Any, List

from app.parsers.dsv_waybill import is_dsv_waybill_text, parse_dsv_waybill_from_text, extract_consignment_from_pdfplumber

import pdfplumber

from app.schemas import (
    EvidenceCandidate,
    InvoiceLine,
    PdfParseResponse,
    PdfTableCandidate,
    PdfTextSpan,
)

# ── generic line extraction regex ──
_AMOUNT_RE = re.compile(r'(?:AED|USD|KRW|EUR)?\s*([\d,]+\.?\d{0,2})\s*(?:AED|USD|KRW|EUR)?', re.IGNORECASE)
_CURRENCY_RE = re.compile(r'\b(AED|USD|KRW|EUR)\b', re.IGNORECASE)
_QTY_RE = re.compile(r'\b(\d+(?:\.\d+)?)\s*(?:pcs|units|kg|ton|TEU|lot|set|ea|box|ctn)\b', re.IGNORECASE)
_RATE_RE = re.compile(r'\b([\d,]+\.?\d{0,2})\s*(?:/\s*(?:pcs|unit|kg|ton|TEU|lot|set|ea|box|ctn|day))\b', re.IGNORECASE)
_DESC_LINE_RE = re.compile(r'^(.{8,120})$')  # reasonable description line
_HEADER_KEYWORDS = {'description', 'item', 'charge', 'product', 'service', 'line', 'no', 'qty', 'quantity', 'rate', 'amount', 'total', 'price', 'unit price', 'currency', 'vendor', 'supplier', 'date', 'invoice'}
_FOOTER_KEYWORDS = {'subtotal', 'total', 'grand total', 'vat', 'tax', 'total due', 'balance', 'page', 'continued', 'remarks', 'notes'}

# ── table header detection ──
def _is_header_row(row: list[str]) -> bool:
    joined = ' '.join(c.lower().strip() for c in row)
    return bool(_HEADER_KEYWORDS & set(joined.split()))

def _is_footer_row(row: list[str]) -> bool:
    joined = ' '.join(c.lower().strip() for c in row)
    return bool(_FOOTER_KEYWORDS & set(joined.split()))

def _find_amount_col(row: list[str]) -> Optional[int]:
    for i, cell in enumerate(row):
        if _AMOUNT_RE.search(cell):
            return i
    return None

def _extract_currency(text: str) -> str:
    m = _CURRENCY_RE.search(text)
    return m.group(1).upper() if m else 'AED'

def _clean_amount(s: str) -> Optional[float]:
    s = re.sub(r'[^\d.,]', '', s.replace(',', ''))
    if not s:
        return None
    try:
        return float(s.replace(',', ''))
    except ValueError:
        return None

def extract_generic_invoice_lines(
    text_spans: List[PdfTextSpan],
    table_candidates: List[PdfTableCandidate],
    *,
    currency_hint: str = 'AED',
) -> tuple[List[InvoiceLine], float]:
    """Extract generic InvoiceLines from non-DSV PDF text/table content.

    Strategy (plan §Track ①):
    1. Table candidate rows — detect header/footer, map amount/qty/desc columns
    2. Text-line regex fallback — amount-bearing lines as line items
    3. Assign progressive line IDs and per-line confidence

    Returns (invoice_lines, extraction_confidence).
    """
    lines: list[InvoiceLine] = []
    used_texts: set[str] = set()

    # ── 1. table-based extraction ──
    for tc in table_candidates:
        rows = tc.rows or []
        if len(rows) < 2:
            continue
        header_idx = -1
        for i, row in enumerate(rows):
            if _is_header_row(row):
                header_idx = i
                break
        data_start = header_idx + 1 if header_idx >= 0 else 0
        amount_col: Optional[int] = None
        if header_idx >= 0 and header_idx < len(rows):
            amount_col = _find_amount_col(rows[header_idx])
        if amount_col is None:
            for row in rows[data_start:]:
                amount_col = _find_amount_col(row)
                if amount_col is not None:
                    break
        if amount_col is None and len(rows[0]) > 0:
            amount_col = len(rows[0]) - 1  # last column guess

        for row_idx, row in enumerate(rows[data_start:]):
            if _is_footer_row(row) or _is_header_row(row):
                continue
            if amount_col is None or amount_col >= len(row):
                continue
            amt_str = row[amount_col].strip()
            amount = _clean_amount(amt_str)
            if amount is None or amount <= 0:
                continue
            desc_parts = [c for i, c in enumerate(row) if i != amount_col and c.strip()]
            description = ' '.join(desc_parts)[:200] or f"Table line {row_idx + 1}"
            currency = _extract_currency(' '.join(row)) or currency_hint
            qty = None
            rate_val = None
            for cell in row:
                qm = _QTY_RE.search(cell)
                if qm and qty is None:
                    try:
                        qty = float(qm.group(1))
                    except ValueError:
                        pass
                rm = _RATE_RE.search(cell)
                if rm and rate_val is None:
                    try:
                        rate_val = float(rm.group(1).replace(',', ''))
                    except ValueError:
                        pass
            # build line_id from page + index
            line_id = f"pdf_t_{tc.page}_{len(lines)}"
            lines.append(InvoiceLine(
                line_id=line_id,
                description=description,
                currency=currency,
                amount=amount,
                qty=qty,
                rate=rate_val,
                source_ref={'table_page': tc.page, 'table_index': tc.page, 'extraction': 'generic_table'},
            ))
            used_texts.add(description[:40])

    # ── 2. text-line fallback ──
    if not lines:
        all_text = '\n'.join(s.text for s in text_spans if getattr(s, 'text', None))
        for text_line in all_text.splitlines():
            text_line = text_line.strip()
            if len(text_line) < 8 or len(text_line) > 200:
                continue
            if not re.search(r'\d', text_line):
                continue
            amt_m = _AMOUNT_RE.findall(text_line)
            if not amt_m:
                continue
            amounts = [_clean_amount(a) for a in amt_m]
            amounts = [a for a in amounts if a is not None and a > 0]
            if not amounts:
                continue
            amount = amounts[-1]
            currency = _extract_currency(text_line) or currency_hint
            description = re.sub(r'\s*\d[\d,.]*\s*(?:AED|USD|KRW|EUR)?', '', text_line).strip()[:200]
            if not description:
                description = text_line[:100]
            line_id = f"pdf_l_{len(lines)}"
            lines.append(InvoiceLine(
                line_id=line_id,
                description=description,
                currency=currency,
                amount=amount,
                source_ref={'source': 'text_line_fallback', 'text': text_line[:200]},
            ))

    # ── 3. confidence ──
    if lines and table_candidates:
        conf = 0.85
    elif lines:
        conf = 0.60  # text-line fallback is lower confidence
    else:
        conf = 0.0

    return lines, conf

_ref_patterns = [
    re.compile(r'\bHVDC[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bBL[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bDO[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bINV[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bPO[-_][A-Z0-9-]+', re.IGNORECASE),
]

# ── existing code continues ──

# SHPT port from 01_DSV_SHPT (missing shipment doc mapping, reviewer pdf_source_data full + SHPT 특화)
# From SHPT enhanced_audit, joiners, rules: ShipmentID pattern HVDC-ADOPT-xxx, doc types BOE/DO/DN, content-based mapping
SHPT_SHIPMENT_RE = re.compile(r'HVDC-(?:ADOPT|DSV)-([A-Z0-9-]+)', re.IGNORECASE)
SHPT_DOC_TYPE_RE = re.compile(r'_(BOE|DO|DN|CarrierInvoice|DAS)\b', re.IGNORECASE)

def extract_shpt_shipment_doc_mapping(text: str, filename: str = "") -> Dict[str, Any]:
    """Ported SHPT supporting doc mapping for source_data (addresses 누락된 SHPT doc extraction)."""
    combined = f"{filename} {text}"
    m = SHPT_SHIPMENT_RE.search(combined)
    shipment_id = m.group(1) if m else None
    dt = SHPT_DOC_TYPE_RE.search(combined)
    doc_type = dt.group(1) if dt else None
    is_portal = bool(re.search(r'APPOINTMENT|DPC|DOCUMENT PROCESSING|PORTAL', combined, re.I))
    return {
        "shipment_id": shipment_id,
        "doc_type": doc_type,
        "is_portal_fee": is_portal,
    }


def _compute_page_conf(text: str, chars: list[dict]) -> float:
    """Per plan §4.4: min(1.0, char_count / 500). Falls back to text len."""
    n = len(text or "") or len(chars or [])
    return min(1.0, n / 500.0)


def _bbox_from_chars(chars: list[dict]) -> Optional[tuple[float, float, float, float]]:
    if not chars:
        return None
    try:
        x0 = min(c.get("x0", 0) for c in chars)
        y0 = min(c.get("top", 0) for c in chars)
        x1 = max(c.get("x1", 0) for c in chars)
        y1 = max(c.get("bottom", 0) for c in chars)
        return (float(x0), float(y0), float(x1), float(y1))
    except Exception:
        return None


def parse_pdf_text_bytes(
    raw: bytes, *, file_id: str, file_name: str, parser_version: str
) -> PdfParseResponse:
    issues: list[str] = []
    text_spans: list[PdfTextSpan] = []
    table_candidates: list[PdfTableCandidate] = []
    evidence: list[EvidenceCandidate] = []
    all_page_texts: list[str] = []
    page_confs: list[float] = []
    is_text_based = False
    page_count = 0

    if len(raw) > 10 * 1024 * 1024:
        issues.append("PDF_TOO_LARGE")
        return PdfParseResponse(
            file_id=file_id,
            parser_version=parser_version or "parser-0.2.0-pdf-0.1.0",
            text_spans=[],
            table_candidates=[],
            pdf_page_count=0,
            parser_confidence=0.0,
            is_text_based=False,
            evidence_candidates=[],
            parser_issues=issues,
        )

    if b"/Encrypt" in raw:
        issues.append("PDF_ENCRYPTED")
        return PdfParseResponse(
            file_id=file_id,
            parser_version=parser_version or "parser-0.2.0-pdf-0.1.0",
            text_spans=[],
            table_candidates=[],
            pdf_page_count=0,
            parser_confidence=0.0,
            is_text_based=False,
            evidence_candidates=[],
            parser_issues=issues,
        )

    try:
        with pdfplumber.open(BytesIO(raw)) as pdf:
            page_count = len(pdf.pages)

            # Extract consignment table for DSV waybill (PDF is already open)
            consignment: Optional[dict] = None
            try:
                consignment = extract_consignment_from_pdfplumber(pdf, max_pages=2)
            except Exception:
                pass

            for p_idx, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                all_page_texts.append(text)
                chars = getattr(page, "chars", []) or []
                if text.strip():
                    is_text_based = True

                pconf = _compute_page_conf(text, chars)
                page_confs.append(pconf)

                if text.strip():
                    bbox = _bbox_from_chars(chars)
                    text_spans.append(
                        PdfTextSpan(
                            page=p_idx,
                            text=text[:2000],
                            bbox=bbox,
                            confidence=round(pconf, 3),
                        )
                    )
                    # Evidence via ref patterns (similar to md parser)
                    for line in text.splitlines()[:30]:
                        for pat in _ref_patterns:
                            m = pat.search(line)
                            if m:
                                evidence.append(
                                    EvidenceCandidate(
                                        source_file_id=file_id,
                                        text_span=line[:200],
                                        matched_reference=m.group(0).upper(),
                                        confidence=0.80,
                                    )
                                )
                                break

                # Tables (P3A captures candidates; P3B may map to InvoiceLine)
                try:
                    tables = page.extract_tables() or []
                    for tbl in tables:
                        if not tbl:
                            continue
                        rows = [[str(c) if c is not None else "" for c in row] for row in tbl]
                        if rows:
                            # simple table conf: non-empty cell ratio
                            total_cells = sum(len(r) for r in rows)
                            non_empty = sum(sum(1 for c in r if c) for r in rows)
                            tconf = (non_empty / total_cells) if total_cells else 0.6
                            table_candidates.append(
                                PdfTableCandidate(
                                    page=p_idx, rows=rows[:40], confidence=round(min(1.0, tconf), 3)
                                )
                            )
                except Exception:
                    # table extraction optional; continue
                    pass

            full_text = "\n".join(all_page_texts)
            if is_dsv_waybill_text(full_text):
                parsed = parse_dsv_waybill_from_text(full_text, consignment=consignment)
                fields = parsed.get("fields", {}) or {}
                for key in ("waybill_no", "printed_date", "do_no", "cust_ref", "bol_no", "order_no", "job_no", "po_no", "head_plate", "trailer_plate", "driver_name", "trip_no"):
                    value = fields.get(key)
                    if value is not None:
                        evidence.append(
                            EvidenceCandidate(
                                source_file_id=file_id,
                                text_span=str(value),
                                matched_reference=str(value)[:100],
                                confidence=0.85,
                                doc_kind="DSV_WAYBILL",
                            )
                        )
                lane = parsed.get("lane", {}) or {}
                for lane_key in ("origin_raw", "destination_raw", "origin_norm", "destination_norm"):
                    value = lane.get(lane_key)
                    if value is not None:
                        evidence.append(
                            EvidenceCandidate(
                                source_file_id=file_id,
                                text_span=str(value),
                                matched_reference=str(value)[:100],
                                confidence=0.85,
                                doc_kind="DSV_WAYBILL",
                            )
                        )
                timeline = parsed.get("timeline", {}) or {}
                for tl_key, tl_value in timeline.items():
                    if tl_value is not None:
                        evidence.append(
                            EvidenceCandidate(
                                source_file_id=file_id,
                                text_span=str(tl_value),
                                matched_reference=str(tl_value)[:100],
                                confidence=0.85,
                                doc_kind="DSV_WAYBILL",
                            )
                        )

                # DOMESTIC: add structured waybill lane data as a single evidence candidate
                wf = {
                    "origin": lane.get("origin_raw"),
                    "destination": lane.get("destination_raw"),
                    "origin_norm": lane.get("origin_norm"),
                    "destination_norm": lane.get("destination_norm"),
                    "vehicle": fields.get("req_truck_type"),
                    "waybill_no": fields.get("waybill_no"),
                    "trip_no": fields.get("trip_no"),
                    "confidence": parsed.get("confidence", 0.0),
                    "flags": parsed.get("flags", []),
                }
                evidence.append(
                    EvidenceCandidate(
                        source_file_id=file_id,
                        text_span=json.dumps(wf, default=str)[:2000],
                        matched_reference="DSV_LANE_STRUCTURED",
                        confidence=parsed.get("confidence", 0.85),
                        doc_kind="DSV_WAYBILL",
                        waybill_fields=wf,
                    )
                )

    except Exception as e:
        msg = str(e).lower()
        if "encrypt" in msg or "password" in msg or "userpassword" in msg:
            issues.append("PDF_ENCRYPTED")
        else:
            issues.append("PARSE_FAILED")

    agg_conf = round(mean(page_confs), 3) if page_confs else 0.0

    if not is_text_based and "PDF_ENCRYPTED" not in issues and "PDF_TOO_LARGE" not in issues:
        issues.append("SCANNED_PAGE_DETECTED")

    # Fallback evidence if nothing matched
    if not evidence and text_spans:
        evidence.append(
            EvidenceCandidate(
                source_file_id=file_id,
                text_span=text_spans[0].text[:200],
                matched_reference=None,
                confidence=0.25,
            )
        )

    return PdfParseResponse(
        file_id=file_id,
        parser_version=parser_version or "parser-0.2.0-pdf-0.1.0",
        text_spans=text_spans,
        table_candidates=table_candidates,
        pdf_page_count=page_count,
        parser_confidence=agg_conf,
        is_text_based=is_text_based,
        evidence_candidates=evidence,
        parser_issues=issues,
    )
