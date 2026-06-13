"""P3A PDF text parser using pdfplumber (plan §4).

Extracts text spans + table candidates from text-based PDFs for invoice/evidence audit.
- Confidence: per-page char density (min(1, chars/500)), aggregate mean.
- Issues: SCANNED_PAGE_DETECTED (no text), PDF_ENCRYPTED, PDF_TOO_LARGE, PARSE_FAILED.
- Evidence candidates populated from text (ref patterns) + spans.
- Returns PdfParseResponse; route adapts to NormalizedInvoice for now (merge/enhance in P3B web).
"""
from __future__ import annotations

import re
from io import BytesIO
from statistics import mean
from typing import Optional, Dict, Any

import pdfplumber

from app.schemas import (
    EvidenceCandidate,
    PdfParseResponse,
    PdfTableCandidate,
    PdfTextSpan,
)

REF_PATTERNS = [
    re.compile(r'\bHVDC[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bBL[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bDO[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bINV[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bPO[-_][A-Z0-9-]+', re.IGNORECASE),
]

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

    try:
        with pdfplumber.open(BytesIO(raw)) as pdf:
            page_count = len(pdf.pages)
            for p_idx, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
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
                        for pat in REF_PATTERNS:
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
