"""POST /parse endpoint. Phase 1: in-memory blob fetch stub (replace with Vercel Blob signed URL)."""
from __future__ import annotations
import hashlib
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, HTTPException
from app.schemas import ParseRequest, ParseResponse
from app.parsers.xlsx import parse_xlsx_bytes
from app.parsers.md import parse_md_bytes
from app.parsers.txt import parse_txt_bytes
from app.parsers.pdf_text import parse_pdf_text_bytes, extract_shpt_shipment_doc_mapping, extract_generic_invoice_lines  # P3A
from app.parsers.dsv_pdf_hybrid import extract_dsv_from_text, DsvPdfResult  # DSV SHPT line extraction
from app.validators.numeric_integrity import validate_numeric_integrity
from app.schemas import NormalizedInvoice, InvoiceHeader, EvidenceCandidate, SourceDataRow, InvoiceLine

router = APIRouter()

def _fetch_blob(blob_url: str) -> bytes:
    """Phase 1 stub. In production, fetch from Vercel Blob signed URL using BLOB_READ_WRITE_TOKEN."""
    if blob_url.startswith("gs://"):
        parsed = urlparse(blob_url)
        bucket_name = parsed.netloc
        object_name = parsed.path.lstrip("/")
        if not bucket_name or not object_name:
            raise ValueError(f"invalid GCS URI: {blob_url}")
        from google.cloud import storage
        client = storage.Client()
        return client.bucket(bucket_name).blob(object_name).download_as_bytes()

    with httpx.Client(timeout=10.0) as client:
        r = client.get(blob_url)
        r.raise_for_status()
        return r.content


def _dsv_lines_to_invoice_lines(dsv: DsvPdfResult) -> list[InvoiceLine]:
    """Map DSV hybrid LineItem -> worker InvoiceLine. amount = total (incl. VAT) when
    present, else the pre-VAT amount; shipment_ref from the document's first shipment.
    The parser-stage gate_verdict is intentionally NOT carried — Vercel decides verdict.
    """
    shipment = dsv.keys.get('shipment_no') or None
    out: list[InvoiceLine] = []
    for li in dsv.line_items:
        amount = li.total_aed if li.total_aed is not None else li.amount_aed
        if amount is None:
            continue  # no auditable amount -> not a line (run-route guard handles 0-line)
        currency = li.currency if li.currency in ('AED', 'USD') else 'AED'
        out.append(InvoiceLine(
            line_id=li.line_id,
            shipment_ref=shipment,
            description=li.description or li.source,
            currency=currency,
            amount=float(amount),
            qty=li.qty,
            rate=li.rate,
            type_b=li.type_b,
            for_charge_component=(li.container or None),
            source_ref={
                'source': li.source,
                'page': li.page,
                'doc_type': dsv.doc_type,
                'evidence_status': li.evidence_status,
                'vat_aed': li.vat_aed,
                'amount_aed': li.amount_aed,
                'total_aed': li.total_aed,
                'extraction_note': li.extraction_note,
            },
        ))
    return out

@router.post('/parse', response_model=ParseResponse, deprecated=True)
def parse_deprecated_alias(req: ParseRequest) -> ParseResponse:
    return parse_v1(req)

@router.post('/v1/parse', response_model=ParseResponse)
def parse_v1(req: ParseRequest) -> ParseResponse:
    try:
        raw = _fetch_blob(req.blob_url)
        source_sha256 = hashlib.sha256(raw).hexdigest()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'BLOB_FETCH_FAILED: {e!s}')

    is_domestic = getattr(req, 'workflow_type', 'SHIPMENT') == 'DOMESTIC'

    source_data: list[SourceDataRow] = []
    parser_issues: list[str] = []
    try:
        if req.file_type == 'xlsx':
            ni = parse_xlsx_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
        elif req.file_type == 'md':
            ni = parse_md_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
        elif req.file_type == 'txt':
            ni = parse_txt_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
        elif req.file_type == 'pdf':
            # P3A: pdfplumber extraction -> evidence + page text/tables. P3B/Phase 2.5:
            # DSV SHPT hybrid parser turns the page text/tables into real invoice_lines
            # (doc_type classification + charge-line extraction). Final verdict stays in Vercel.
            pdf_res = parse_pdf_text_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
            parser_issues = list(pdf_res.parser_issues or [])
            if 'PDF_ENCRYPTED' in (pdf_res.parser_issues or []) or 'PDF_TOO_LARGE' in (pdf_res.parser_issues or []):
                # P3B §5.3 / §4.3: encrypted PDF -> 415 PARSE_PDF_UNSUPPORTED (large -> 422)
                status = 415 if 'PDF_ENCRYPTED' in (pdf_res.parser_issues or []) else 422
                raise HTTPException(status_code=status, detail='PARSE_PDF_UNSUPPORTED')
            # DSV SHPT line extraction reuses already-parsed text spans + tables (no 2nd pdfplumber pass).
            full_text = "\n".join(s.text for s in (pdf_res.text_spans or []) if getattr(s, 'text', None))
            dsv_tables = [
                {"page": tc.page, "table_index": i, "rows": tc.rows}
                for i, tc in enumerate(pdf_res.table_candidates or [])
            ]
            dsv = extract_dsv_from_text(full_text, dsv_tables, file_name=req.blob_ref, parser_issues=list(pdf_res.parser_issues or []))
            line_currency = next((li.currency for li in dsv.line_items if li.currency in ('AED', 'USD')), 'AED')
            invoice_lines = _dsv_lines_to_invoice_lines(dsv)

            # Generic fallback: when DSV extraction produces 0 lines, try table/text-based extraction
            generic_used = False
            if not invoice_lines:
                generic_lines, generic_conf = extract_generic_invoice_lines(
                    pdf_res.text_spans or [],
                    pdf_res.table_candidates or [],
                    currency_hint=line_currency,
                )
                if generic_lines:
                    invoice_lines = generic_lines
                    generic_used = True

            # Domestic: enrich invoice lines with DSV waybill lane data (origin/destination/vehicle)
            if is_domestic:
                dsv_lane_origin: str | None = None
                dsv_lane_dest: str | None = None
                dsv_lane_vehicle: str | None = None
                for ev in (pdf_res.evidence_candidates or []):
                    if getattr(ev, 'doc_kind', None) == 'DSV_WAYBILL' and hasattr(ev, 'waybill_fields') and ev.waybill_fields:
                        wf = ev.waybill_fields
                        dsv_lane_origin = wf.get('origin') or dsv_lane_origin
                        dsv_lane_dest = wf.get('destination') or dsv_lane_dest
                        dsv_lane_vehicle = wf.get('vehicle') or dsv_lane_vehicle
                        break  # first structured waybill has what we need
                for il in invoice_lines:
                    if dsv_lane_origin:
                        il.origin = dsv_lane_origin
                    if dsv_lane_dest:
                        il.destination = dsv_lane_dest
                    if dsv_lane_vehicle:
                        il.vehicle = dsv_lane_vehicle

            ni = NormalizedInvoice(
                invoice_id=f"inv_{req.file_id}",
                invoice_header=InvoiceHeader(
                    invoice_no=(dsv.keys.get('invoice_no') or None),
                    vendor=None, issue_date=(dsv.keys.get('date') or None),
                    currency=line_currency, invoice_total=None,
                ),
                invoice_lines=invoice_lines,
                evidence_candidates=pdf_res.evidence_candidates or [],
                parser_confidence=pdf_res.parser_confidence,
                parser_version=pdf_res.parser_version,
            )
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
        else:
            raise HTTPException(status_code=422, detail=f'UNSUPPORTED_FILE_TYPE: {req.file_type}')
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f'PARSE_XLSX_FAILED: {e!s}') from e

    if req.file_type == 'pdf':
        # Phase 3 reviewer feedback + domestic fullset + SHPT 01 folder 이식: 완전 pdf_source_data population from actual text_spans + SHPT doc mapping
        # Ported from 01_DSV_SHPT rules_enhanced/joiners/enhanced_audit: SHPT shipment doc mapping (HVDC-ADOPT pattern, doc_type BOE/DO/DN, portal/gate metadata)
        for span in (pdf_res.text_spans or []):
            if not getattr(span, 'text', None):
                continue
            h = hashlib.sha256(span.text.encode('utf-8')).hexdigest()[:16]
            shpt_map = extract_shpt_shipment_doc_mapping(span.text, filename=req.blob_ref)  # from pdf_text.py port
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
        # Domestic: promote DSV waybill lane data to source_data for domestic_lane_check
        if is_domestic:
            for ev in (pdf_res.evidence_candidates or []):
                if getattr(ev, 'doc_kind', None) == 'DSV_WAYBILL' and hasattr(ev, 'waybill_fields') and ev.waybill_fields:
                    wf = ev.waybill_fields
                    lane_info = {
                        "origin": wf.get("loading_address") or wf.get("origin_norm"),
                        "destination": wf.get("destination") or wf.get("destination_norm"),
                        "waybill_no": wf.get("waybill_no"),
                        "trip_no": wf.get("trip_no"),
                        "vehicle": wf.get("req_truck_type"),
                    }
                    source_data.append(SourceDataRow(
                        file_id=req.file_id,
                        source_ref="dsv_waybill_lane",
                        original_text=str(lane_info)[:500],
                        normalized_value=lane_info.get("origin") or lane_info.get("waybill_no"),
                        confidence=ev.confidence,
                        routing_pattern="DOMESTIC_DSV_LANE",
                        doc_type="DSV_WAYBILL",
                    ))
        # Forward issues for orchestrator error code mapping (P3B/P3C §5.3, §4.3)
        # Attach to the response object so TS run can inspect (parseRes.parser_issues)
        # (keeps ParseResponse shape for now; P3B+ can evolve to richer payload)
        # Note: pdf details (spans/tables/ issues / is_text_based / page_count) carried in pdf_res for client that asks pdf-specific.
        # For now, to keep ParseResponse shape, we rely on evidence + confidence in normalized. P3C trace will use page info via updated paths.
    if req.file_type == 'pdf_json':
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
    validate_numeric_integrity(ni.invoice_lines)

    parse_result_id = 'pr_' + hashlib.sha1(f"{req.job_id}|{req.file_id}|{req.parser_version}".encode()).hexdigest()[:12]
    return ParseResponse(parse_result_id=parse_result_id, job_id=req.job_id, file_id=req.file_id, source_sha256=source_sha256, normalized=ni, source_data=source_data, parser_issues=parser_issues)

@router.post('/parse/pdf-json', response_model=ParseResponse)
def parse_pdf_json(req: ParseRequest) -> ParseResponse:
    req.file_type = 'pdf_json'
    return parse_v1(req)
