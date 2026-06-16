"""Vision OCR JSON → EvidenceCandidate normalizer."""
from __future__ import annotations
import hashlib
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from app.schemas import InvoiceLine
from app.services.v_vision_rules import parse_vision_text

# Reference patterns for evidence extraction (same as pdf_text.py)
REF_PATTERNS = {
    'HVDC': re.compile(r'HVDC[-_][A-Za-z0-9-]+'),
    'BL': re.compile(r'BL[-_\s]?[A-Z0-9]{4,20}', re.IGNORECASE),
    'DO': re.compile(r'DO[-_\s]?[A-Z0-9]{3,15}', re.IGNORECASE),
    'INV': re.compile(r'INV[-_\s]?[A-Z0-9]{3,15}', re.IGNORECASE),
    'PO': re.compile(r'PO[-_\s]?[A-Z0-9]{3,15}', re.IGNORECASE),
    'BOE': re.compile(r'BOE[-_\s]?[A-Z0-9]{3,15}', re.IGNORECASE),
    'INVOICE_NO': re.compile(r'(?:Invoice\s*No[.:]?|Invoice\s*Number)[:\s]*([A-Za-z0-9-]+)', re.IGNORECASE),
    'TOTAL': re.compile(r'(?:Total|Grand\s*Total|Amount\s*Due)[:\s]*([\d,]+\.?\d*)', re.IGNORECASE),
    'VENDOR': re.compile(r'(?:Vendor|Supplier|From)[:\s]*([A-Za-z0-9\s.,]+?)(?:\n|$)', re.IGNORECASE),
}

@dataclass
class VisionNormalizedResult:
    """Normalized output from Vision OCR text."""
    file_id: str
    full_text: str = ""
    confidence: float = 0.0
    page_count: int = 0
    evidence_candidates: list[dict] = field(default_factory=list)
    invoice_no: Optional[str] = None
    vendor: Optional[str] = None
    invoice_total: Optional[float] = None
    issues: list[str] = field(default_factory=list)
    dsv_parse_result: Optional[dict[str, Any]] = None

def normalize_vision_output(
    vision_json: dict,
    file_id: str,
    file_name: str = "",
) -> VisionNormalizedResult:
    """Convert Vision OCR JSON output to structured evidence and invoice fields."""
    result = VisionNormalizedResult(file_id=file_id)
    
    pages = vision_json.get('responses', []) or vision_json.get('pages', [])
    result.page_count = len(pages)
    
    all_text_parts = []
    page_confs = []
    
    for i, page in enumerate(pages):
        # Extract fullTextAnnotation
        text = ""
        if 'fullTextAnnotation' in page:
            text = page['fullTextAnnotation'].get('text', '')
        elif 'text' in page:
            text = page['text']
        
        if text:
            all_text_parts.append(text)
        
        # Extract confidence
        if 'fullTextAnnotation' in page:
            pages_list = page['fullTextAnnotation'].get('pages', [])
            for p in pages_list:
                if 'blocks' in p:
                    for block in p['blocks']:
                        for paragraph in block.get('paragraphs', []):
                            for word in paragraph.get('words', []):
                                conf = word.get('confidence', 0.0)
                                page_confs.append(conf)
                if 'confidence' in p:
                    page_confs.append(p['confidence'])
        elif 'confidence' in page:
            page_confs.append(page['confidence'])
    
    result.full_text = '\n'.join(all_text_parts)
    
    if page_confs:
        result.confidence = sum(page_confs) / len(page_confs)
    elif result.page_count > 0 and result.full_text:
        result.confidence = min(1.0, len(result.full_text) / 500)
    else:
        result.confidence = 0.0
        result.issues.append('VISION_LOW_CONFIDENCE')
    
    if not result.full_text.strip():
        result.issues.append('SCANNED_PAGE_DETECTED')
        return result

    dsv_result = parse_vision_text(
        result.full_text,
        file_id=file_id,
        file_name=file_name,
        confidence=result.confidence,
        page_count=result.page_count,
    )
    result.dsv_parse_result = asdict(dsv_result)
    
    # Extract evidence candidates from full text
    for doc_kind, pattern in REF_PATTERNS.items():
        matches = pattern.findall(result.full_text)
        for match in matches[:20]:  # Cap per pattern
            match_str = match if isinstance(match, str) else match[0]
            match_str = match_str.strip()
            if not match_str:
                continue
            h = hashlib.sha256(match_str.encode('utf-8')).hexdigest()[:16]
            result.evidence_candidates.append({
                'source_file_id': file_id,
                'source_engine': 'google_vision',
                'matched_reference': match_str,
                'doc_kind': doc_kind,
                'confidence': min(0.85, result.confidence),
                'text_span_hash': f"sha256:{h}",
            })

    for candidate in dsv_result.evidence_candidates:
        result.evidence_candidates.append(candidate)
    
    # Try to extract invoice_no
    for pattern_name in ['INVOICE_NO']:
        p = REF_PATTERNS.get(pattern_name)
        if p:
            m = p.search(result.full_text)
            if m:
                result.invoice_no = m.group(1).strip()
                break
    
    # Try to extract total
    p = REF_PATTERNS.get('TOTAL')
    if p:
        m = p.search(result.full_text)
        if m:
            try:
                result.invoice_total = float(m.group(1).replace(',', ''))
            except ValueError:
                pass
    
    return result


def vision_result_to_invoice_lines(result: VisionNormalizedResult, file_id: str) -> list[InvoiceLine]:
    """Convert VisionNormalizedResult.dsv_parse_result.line_items to InvoiceLine[].

    Returns empty list when no structured lines can be extracted.
    Low confidence or zero lines → upstream gate assigns AMBER (never auto-PASS).
    """
    dsv = result.dsv_parse_result or {}
    keys = dsv.get('keys', {}) or {}
    line_items = dsv.get('line_items', []) or []
    out: list[InvoiceLine] = []
    for li in line_items:
        amount = li.get('total_aed') or li.get('amount_aed')
        if amount is None:
            continue
        currency = li.get('currency', 'AED')
        if currency not in ('AED', 'USD'):
            currency = 'AED'
        out.append(InvoiceLine(
            line_id=li.get('line_id', f"ocr_{file_id}_{len(out)}"),
            description=li.get('description') or li.get('source', ''),
            currency=currency,
            amount=float(amount),
            qty=li.get('qty'),
            rate=li.get('rate'),
            type_b=li.get('type_b'),
            source_ref={
                'source': li.get('source', ''),
                'page': li.get('page'),
                'doc_type': keys.get('doc_type'),
                'extraction': 'vision_ocr',
                'evidence_status': li.get('evidence_status'),
            },
        ))
    return out
