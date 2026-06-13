"""Markdown evidence parser. Returns NormalizedInvoice with invoice_lines=[] and evidence_candidates."""
from __future__ import annotations
import re
from app.schemas import EvidenceCandidate, NormalizedInvoice, InvoiceHeader

REF_PATTERNS = [
    re.compile(r'\bHVDC[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bBL[-_][A-Z0-9-]+',   re.IGNORECASE),
    re.compile(r'\bDO[-_][A-Z0-9-]+',    re.IGNORECASE),
    re.compile(r'\bINV[-_][A-Z0-9-]+',   re.IGNORECASE),
]

def parse_md_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    text = raw.decode('utf-8', errors='replace')
    candidates: list[EvidenceCandidate] = []
    for line in text.splitlines():
        for pat in REF_PATTERNS:
            m = pat.search(line)
            if m:
                candidates.append(EvidenceCandidate(
                    source_file_id=file_id,
                    text_span=line[:200],
                    matched_reference=m.group(0).upper(),
                    confidence=0.85
                ))
                break
    if not candidates and text.strip():
        candidates.append(EvidenceCandidate(
            source_file_id=file_id,
            text_span=text[:200],
            matched_reference=None,
            confidence=0.2
        ))
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
        invoice_lines=[],
        evidence_candidates=candidates,
        parser_confidence=0.7,
        parser_version=parser_version
    )
