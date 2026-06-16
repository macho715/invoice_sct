"""Vision preflight + async OCR routes.

Endpoints:
  POST /v1/preflight       — Decide whether a PDF needs Vision OCR.
  POST /v1/vision/start    — Kick off async document text detection.
  POST /v1/vision/collect  — Poll and collect OCR results.
"""
from __future__ import annotations
import hashlib
import logging
from fastapi import APIRouter

from app.schemas import (
    PreflightRequest,
    PreflightResponse,
    VisionCollectRequest,
    VisionCollectResponse,
    VisionStartRequest,
    VisionStartResponse,
)
from app.services.vision_client import VisionClient
from app.services.vision_normalizer import normalize_vision_output

logger = logging.getLogger(__name__)

router = APIRouter()

vision_client = VisionClient()

def _build_route_key(job_id: str, file_id: str) -> str:
    h = hashlib.sha1(f"{job_id}|{file_id}|vision".encode()).hexdigest()[:12]
    return f"vision_{h}"


# ---------------------------------------------------------------------------
# /v1/preflight
# ---------------------------------------------------------------------------

@router.post('/v1/preflight', response_model=PreflightResponse)
def preflight(req: PreflightRequest) -> PreflightResponse:
    """Decide whether a PDF needs Vision OCR, MarkItDown, or text-parser routing.

    Always returns a response — even when Vision is disabled — so the
    orchestrator can use the ``recommended_route`` field to branch.
    """
    # Stub: in P3B+ this will inspect GCS object metadata / pdfplumber
    # and possibly call Vision safe_search before routing.
    return PreflightResponse(
        job_id=req.job_id,
        file_id=req.file_id,
        gcs_uri=req.gcs_uri,
        is_text_based=False,
        is_scanned=False,
        is_encrypted=False,
        page_count=0,
        text_density=None,
        parser_issues=[],
        recommended_route='text_parser',
        requires_vision=False,
        requires_markitdown=False,
    )


# ---------------------------------------------------------------------------
# /v1/vision/start
# ---------------------------------------------------------------------------

@router.post('/v1/vision/start', response_model=VisionStartResponse)
def vision_start(req: VisionStartRequest) -> VisionStartResponse:
    """Start async Google Vision document text detection.

    When google-cloud-vision is not installed, returns ``VISION_DISABLED``
    so the caller can fall back to text parsing or MarkItDown.
    """
    if not vision_client.available:
        return VisionStartResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            status='VISION_DISABLED',
            error_code=vision_client.unavailable_reason,
        )

    result = vision_client.start_async_text_detection(
        source_gcs_uri=req.source_gcs_uri,
        output_gcs_prefix=req.output_gcs_prefix,
    )

    if result.get('status') == 'VISION_DISABLED':
        return VisionStartResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            status='VISION_DISABLED',
            error_code=result.get('error_code'),
        )

    return VisionStartResponse(
        job_id=req.job_id,
        file_id=req.file_id,
        operation_name=result.get('operation_name'),
        output_gcs_prefix=result.get('output_gcs_prefix'),
        status='STARTED',
    )


# ---------------------------------------------------------------------------
# /v1/vision/collect
# ---------------------------------------------------------------------------

@router.post('/v1/vision/collect', response_model=VisionCollectResponse)
def vision_collect(req: VisionCollectRequest) -> VisionCollectResponse:
    """Poll and collect Vision OCR results from GCS output prefix.

    Returns ``VISION_DISABLED`` when the library is not installed, or
    ``COLLECTED`` with page_count, confidence, and ocr_json_gcs_uri on
    success.
    """
    if not vision_client.available:
        return VisionCollectResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            operation_name=req.operation_name,
            status='VISION_DISABLED',
            error_code=vision_client.unavailable_reason,
        )

    # Poll operation status first
    op_status = vision_client.get_operation_status(req.operation_name)
    if op_status.get('status') == 'VISION_DISABLED':
        return VisionCollectResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            operation_name=req.operation_name,
            status='VISION_DISABLED',
            error_code=op_status.get('error_code'),
        )
    if op_status.get('status') == 'RUNNING':
        return VisionCollectResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            operation_name=req.operation_name,
            status='RUNNING',
        )

    # Collect results
    output_gcs_prefix = op_status.get('output_gcs_prefix')
    if not output_gcs_prefix:
        return VisionCollectResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            operation_name=req.operation_name,
            status='VISION_OUTPUT_NOT_FOUND',
            error_code='VISION_OUTPUT_PREFIX_NOT_FOUND',
        )
    result = vision_client.collect_result(output_gcs_prefix=output_gcs_prefix)
    if result.get('status') in {'VISION_DISABLED', 'VISION_OUTPUT_NOT_FOUND'}:
        return VisionCollectResponse(
            job_id=req.job_id,
            file_id=req.file_id,
            operation_name=req.operation_name,
            status=result.get('status'),
            error_code=result.get('error_code'),
        )

    normalized = normalize_vision_output(
        {"responses": result.get("responses", [])},
        file_id=req.file_id,
        file_name=req.file_id,
    )
    dsv_result = normalized.dsv_parse_result

    return VisionCollectResponse(
        job_id=req.job_id,
        file_id=req.file_id,
        operation_name=req.operation_name,
        ocr_json_gcs_uri=result.get('ocr_json_gcs_uri'),
        ocr_json_gcs_uris=result.get('ocr_json_gcs_uris', []),
        page_count=result.get('page_count', 0),
        confidence=result.get('confidence', 0.0),
        status='COLLECTED',
        evidence_candidate_count=len(normalized.evidence_candidates),
        dsv_parse_result=dsv_result,
        issues=normalized.issues,
    )
