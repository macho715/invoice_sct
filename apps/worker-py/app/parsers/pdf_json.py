from __future__ import annotations

import json
import logging
import re
from statistics import mean
from typing import Any

from app.schemas import (
    EvidenceCandidate,
    PdfParseResponse,
    PdfTableCandidate,
    PdfTextSpan,
)

logger = logging.getLogger(__name__)

REF_PATTERNS = [
    re.compile(r'\bHVDC[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bBL[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bDO[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bINV[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bPO[-_][A-Z0-9-]+', re.IGNORECASE),
]


def _extract_evidence(
    text: str,
    file_id: str,
) -> list[EvidenceCandidate]:
    evidence: list[EvidenceCandidate] = []
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
    return evidence


def _compute_page_confidence(spans: list[dict[str, Any]]) -> float:
    confs = [s.get("confidence", 0.0) for s in spans if isinstance(s, dict)]
    if confs:
        return round(mean(confs), 3)
    total_chars = sum(len(s.get("text", "")) for s in spans if isinstance(s, dict))
    return round(min(1.0, total_chars / 500.0), 3)


def parse_pdf_json_bytes(
    data: bytes,
    file_id: str,
    file_name: str,
    parser_version: str = "0.1.0",
) -> PdfParseResponse:
    issues: list[str] = []
    text_spans: list[PdfTextSpan] = []
    table_candidates: list[PdfTableCandidate] = []
    evidence: list[EvidenceCandidate] = []
    page_confs: list[float] = []

    try:
        doc = json.loads(data.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning("pdf_json parse failed for %s: %s", file_id, exc)
        issues.append("PDF_JSON_PARSE_FAILED")
        return PdfParseResponse(
            file_id=file_id,
            parser_version=parser_version,
            text_spans=[],
            table_candidates=[],
            pdf_page_count=0,
            parser_confidence=0.0,
            is_text_based=False,
            evidence_candidates=[],
            parser_issues=issues,
        )

    pages = doc.get("pages", [])
    if not isinstance(pages, list):
        pages = []

    page_count = len(pages)
    is_text_based = False

    for page_data in pages:
        if not isinstance(page_data, dict):
            continue

        page_number = page_data.get("page_number", 0)
        if not isinstance(page_number, int) or page_number < 1:
            page_number = pages.index(page_data) + 1

        spans = page_data.get("spans", [])
        if not isinstance(spans, list):
            spans = []

        tables = page_data.get("tables", [])
        if not isinstance(tables, list):
            tables = []

        page_text_parts: list[str] = []
        span_confs: list[float] = []

        for span in spans:
            if not isinstance(span, dict):
                continue
            text = span.get("text", "")
            if not text:
                continue
            bbox_raw = span.get("bbox")
            bbox = None
            if isinstance(bbox_raw, (list, tuple)) and len(bbox_raw) == 4:
                try:
                    bbox = (float(bbox_raw[0]), float(bbox_raw[1]), float(bbox_raw[2]), float(bbox_raw[3]))
                except (TypeError, ValueError):
                    bbox = None
            conf = span.get("confidence", 0.5)
            if not isinstance(conf, (int, float)):
                conf = 0.5
            conf = max(0.0, min(1.0, float(conf)))

            page_text_parts.append(text)
            span_confs.append(conf)
            text_spans.append(
                PdfTextSpan(
                    page=page_number,
                    text=text[:2000],
                    bbox=bbox,
                    confidence=round(conf, 3),
                )
            )

        if page_text_parts:
            is_text_based = True
            combined_text = " ".join(page_text_parts)
            page_confs.append(_compute_page_confidence(spans))
            evidence.extend(_extract_evidence(combined_text, file_id))

        for tbl in tables:
            if not isinstance(tbl, dict):
                continue
            rows_raw = tbl.get("rows", [])
            if not isinstance(rows_raw, list) or not rows_raw:
                continue
            rows = [[str(c) if c is not None else "" for c in row] for row in rows_raw if isinstance(row, list)]
            if not rows:
                continue
            total_cells = sum(len(r) for r in rows)
            non_empty = sum(sum(1 for c in r if c) for r in rows)
            tconf = (non_empty / total_cells) if total_cells else 0.6
            table_candidates.append(
                PdfTableCandidate(
                    page=page_number,
                    rows=rows[:40],
                    confidence=round(min(1.0, tconf), 3),
                )
            )

    agg_conf = round(mean(page_confs), 3) if page_confs else 0.0

    if not is_text_based and "PDF_JSON_PARSE_FAILED" not in issues:
        issues.append("SCANNED_PAGE_DETECTED")

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
        parser_version=parser_version,
        text_spans=text_spans,
        table_candidates=table_candidates,
        pdf_page_count=page_count,
        parser_confidence=agg_conf,
        is_text_based=is_text_based,
        evidence_candidates=evidence,
        parser_issues=issues,
    )
