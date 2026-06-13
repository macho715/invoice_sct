"""POST /parse endpoint. Phase 1: in-memory blob fetch stub (replace with Vercel Blob signed URL)."""
from __future__ import annotations
import hashlib
import httpx
from fastapi import APIRouter, HTTPException
from app.schemas import ParseRequest, ParseResponse
from app.parsers.xlsx import parse_xlsx_bytes
from app.parsers.md import parse_md_bytes
from app.parsers.txt import parse_txt_bytes
from app.parsers.pdf_text import parse_pdf_text_bytes, extract_shpt_shipment_doc_mapping  # P3A
from app.validators.numeric_integrity import validate_numeric_integrity
from app.schemas import NormalizedInvoice, InvoiceHeader, EvidenceCandidate, SourceDataRow

router = APIRouter()

def _fetch_blob(blob_url: str) -> bytes:
    """Phase 1 stub. In production, fetch from Vercel Blob signed URL using BLOB_READ_WRITE_TOKEN."""
    with httpx.Client(timeout=10.0) as client:
        r = client.get(blob_url)
        r.raise_for_status()
        return r.content

@router.post('/parse', response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    try:
        raw = _fetch_blob(req.blob_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'BLOB_FETCH_FAILED: {e!s}')

    source_data: list[SourceDataRow] = []
    if req.file_type == 'xlsx':
        ni = parse_xlsx_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    elif req.file_type == 'md':
        ni = parse_md_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    elif req.file_type == 'txt':
        ni = parse_txt_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    elif req.file_type == 'pdf':
        # P3A: pdfplumber extraction -> adapt to Normalized (evidence + conf). Full PdfParseResponse available for P3B+ merge/trace.
        pdf_res = parse_pdf_text_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
        if 'PDF_ENCRYPTED' in (pdf_res.parser_issues or []) or 'PDF_TOO_LARGE' in (pdf_res.parser_issues or []):
            # P3B §5.3 / §4.3: encrypted PDF -> 415 PARSE_PDF_UNSUPPORTED (large -> 422)
            status = 415 if 'PDF_ENCRYPTED' in (pdf_res.parser_issues or []) else 422
            raise HTTPException(status_code=status, detail='PARSE_PDF_UNSUPPORTED')
        # Basic adaptation for P3A (P3B will do richer merge to lines + pdf_metadata)
        ni = NormalizedInvoice(
            invoice_id=f"inv_{req.file_id}",
            invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
            invoice_lines=[],
            evidence_candidates=pdf_res.evidence_candidates or [],
            parser_confidence=pdf_res.parser_confidence,
            parser_version=pdf_res.parser_version,
        )
        # Phase 3 reviewer feedback + domestic fullset + SHPT 01 folder 이식: 완전 pdf_source_data population from actual text_spans + SHPT doc mapping
        # Ported from 01_DSV_SHPT rules_enhanced/joiners/enhanced_audit: SHPT shipment doc mapping (HVDC-ADOPT pattern, doc_type BOE/DO/DN, portal/gate metadata)
        for span in (pdf_res.text_spans or []):
            if not getattr(span, 'text', None):
                continue
            h = hashlib.sha256(span.text.encode('utf-8')).hexdigest()[:16]
            shpt_map = extract_shpt_shipment_doc_mapping(span.text, file_name=req.blob_ref)  # from pdf_text.py port
            source_data.append(SourceDataRow(
                file_id=req.file_id,
                source_ref=f"pdf_page_{span.page}",
                original_text=span.text[:500],
                normalized_value=shpt_map.get("shipment_id"),
                confidence=span.confidence,
                routing_pattern="PDF_TEXT_SPAN" if not shpt_map.get("doc_type") else "SHPT_DOC_MAP",
                pdf_page=span.page,
                text_span_hash=f"sha256:{h}",
                doc_type=shpt_map.get("doc_type"),
                shipment_id=shpt_map.get("shipment_id"),
                is_portal_fee=shpt_map.get("is_portal_fee"),
            ))
        # Forward issues for orchestrator error code mapping (P3B/P3C §5.3, §4.3)
        # Attach to the response object so TS run can inspect (parseRes.parser_issues)
        # (keeps ParseResponse shape for now; P3B+ can evolve to richer payload)
        # Note: pdf details (spans/tables/ issues / is_text_based / page_count) carried in pdf_res for client that asks pdf-specific.
        # For now, to keep ParseResponse shape, we rely on evidence + confidence in normalized. P3C trace will use page info via updated paths.
    elif req.file_type == 'pdf_json':
        from app.parsers.pdf_json import parse_pdf_json_bytes
        pdf_res = parse_pdf_json_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
        if 'PDF_JSON_PARSE_FAILED' in (pdf_res.parser_issues or []):
            raise HTTPException(status_code=422, detail='PARSE_PDF_JSON_FAILED')
        ni = NormalizedInvoice(
            invoice_id=f"inv_{req.file_id}",
            invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
            invoice_lines=[],
            evidence_candidates=pdf_res.evidence_candidates or [],
            parser_confidence=pdf_res.parser_confidence,
            parser_version=pdf_res.parser_version,
        )
        for span in (pdf_res.text_spans or []):
            if not getattr(span, 'text', None):
                continue
            h = hashlib.sha256(span.text.encode('utf-8')).hexdigest()[:16]
            source_data.append(SourceDataRow(
                file_id=req.file_id,
                source_ref=f"pdf_page_{span.page}",
                original_text=span.text[:500],
                normalized_value=None,
                confidence=span.confidence,
                routing_pattern="PDF_JSON_SPAN",
                pdf_page=span.page,
                text_span_hash=f"sha256:{h}",
            ))
    else:
        raise HTTPException(status_code=422, detail=f'UNSUPPORTED_FILE_TYPE: {req.file_type}')

    validate_numeric_integrity(ni.invoice_lines)

    parse_result_id = 'pr_' + hashlib.sha1(f"{req.job_id}|{req.file_id}|{req.parser_version}".encode()).hexdigest()[:12]
    return ParseResponse(parse_result_id=parse_result_id, job_id=req.job_id, file_id=req.file_id, normalized=ni, source_data=source_data)

@router.post('/parse/pdf-json', response_model=ParseResponse)
def parse_pdf_json(req: ParseRequest) -> ParseResponse:
    req.file_type = 'pdf_json'
    return parse(req)
