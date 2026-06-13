"""Plain-text evidence parser."""
from __future__ import annotations
import re
from app.parsers.md import REF_PATTERNS
from app.schemas import EvidenceCandidate, NormalizedInvoice, InvoiceHeader

def parse_txt_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    text = raw.decode('utf-8', errors='replace')
    candidates: list[EvidenceCandidate] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for pat in REF_PATTERNS:
            m = pat.search(line)
            if m:
                candidates.append(EvidenceCandidate(
                    source_file_id=file_id,
                    text_span=line[:200],
                    matched_reference=m.group(0).upper(),
                    confidence=0.8
                ))
                break
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
        invoice_lines=[],
        evidence_candidates=candidates,
        parser_confidence=0.6,
        parser_version=parser_version
    )
