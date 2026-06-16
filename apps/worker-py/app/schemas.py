from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict
import hashlib

Currency = Literal['AED', 'USD']
RateBasis = Literal['PER_EA','PER_TRUCK','PER_TEU','PER_CBM','PER_MT','PER_DAY','AT_COST','LUMP_SUM']
RateSource = Literal['CONTRACT','AT_COST','DSV_HANDLING','UNKNOWN']
NumericIntegrity = Literal['PASS','AMBER']

class InvoiceHeader(BaseModel):
    model_config = ConfigDict(extra='forbid')
    invoice_no: Optional[str] = None
    vendor: Optional[str] = None
    issue_date: Optional[str] = None
    currency: Currency
    invoice_total: Optional[float] = None

class InvoiceLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    shipment_ref: Optional[str] = None
    job_number: Optional[str] = None
    description: str
    normalized_description: Optional[str] = None
    qty: Optional[float] = None
    rate: Optional[float] = None
    rate_basis: Optional[RateBasis] = None
    currency: Currency
    amount: float
    numeric_integrity_status: Optional[NumericIntegrity] = None
    numeric_delta: Optional[float] = None
    rate_source_candidate: Optional[RateSource] = None
    for_charge_component: Optional[str] = None
    type_b: Optional[str] = None
    source_ref: dict = Field(default_factory=dict)

class EvidenceCandidate(BaseModel):
    model_config = ConfigDict(extra='ignore')
    source_file_id: str
    text_span: str
    matched_reference: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)
    doc_kind: Optional[str] = None
    waybill_fields: Optional[dict] = Field(default=None)

class NormalizedInvoice(BaseModel):
    model_config = ConfigDict(extra='forbid')
    invoice_id: str
    invoice_header: InvoiceHeader
    invoice_lines: list[InvoiceLine]
    evidence_candidates: list[EvidenceCandidate]
    parser_confidence: float = Field(ge=0.0, le=1.0)
    parser_version: str

class ParseRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    blob_ref: str
    file_id: str
    job_id: str
    file_type: Literal['xlsx','md','txt','pdf','pdf_json']
    parser_version: str
    blob_url: str

# --- P3A PDF text parser models (plan §4.2) ---
class PdfTextSpan(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int  # 1-indexed
    text: str
    bbox: Optional[tuple[float, float, float, float]] = None  # x0, y0, x1, y1
    confidence: float  # 0..1

class PdfTableCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int
    rows: list[list[str]]
    confidence: float

class PdfParseResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    file_id: str
    parser_version: str  # "parser-0.2.0-pdf-0.1.0"
    text_spans: list[PdfTextSpan]
    table_candidates: list[PdfTableCandidate]
    pdf_page_count: int
    parser_confidence: float  # aggregate
    is_text_based: bool
    evidence_candidates: list[EvidenceCandidate]
    parser_issues: list[str]  # e.g. 'SCANNED_PAGE_DETECTED', 'PDF_ENCRYPTED'


# --- Google Vision OCR route models ---
VisionRoute = Literal['text_parser', 'vision_ocr', 'markitdown', 'review_required']
VisionStartStatus = Literal['VISION_DISABLED', 'STARTED', 'STUB']
VisionCollectStatus = Literal['VISION_DISABLED', 'RUNNING', 'COLLECTED', 'VISION_OUTPUT_NOT_FOUND']


class PreflightRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    gcs_uri: str
    file_type: Literal['pdf', 'pdf_json']
    file_role: Literal['invoice_source', 'evidence'] = 'evidence'


class PreflightResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    gcs_uri: str
    is_text_based: bool = False
    is_scanned: bool = False
    is_encrypted: bool = False
    page_count: int = 0
    text_density: Optional[float] = None
    parser_issues: list[str] = Field(default_factory=list)
    recommended_route: VisionRoute = 'review_required'
    requires_vision: bool = False
    requires_markitdown: bool = False


class VisionStartRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    source_gcs_uri: str
    output_gcs_prefix: str


class VisionStartResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    operation_name: Optional[str] = None
    output_gcs_prefix: Optional[str] = None
    status: VisionStartStatus = 'VISION_DISABLED'
    error_code: Optional[str] = None


class VisionCollectRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    operation_name: str


class VisionCollectResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    file_id: str
    operation_name: str
    ocr_json_gcs_uri: Optional[str] = None
    ocr_json_gcs_uris: list[str] = Field(default_factory=list)
    page_count: int = 0
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    status: VisionCollectStatus = 'VISION_DISABLED'
    error_code: Optional[str] = None
    evidence_candidate_count: int = 0
    dsv_parse_result: Optional[dict[str, Any]] = None
    issues: list[str] = Field(default_factory=list)

class ParseResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    parse_result_id: str
    job_id: str
    file_id: str
    source_sha256: str
    normalized: NormalizedInvoice
    # Phase 3 reviewer fix + domestic fullset port: complete pdf_source_data population from actual spans
    source_data: list[SourceDataRow] = Field(default_factory=list)

class DecisionRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    verdict: str
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    rule_version: str
    parser_version: str
    final_recon_status: Optional[str] = None
    zero_count: int
    amber_count: int
    prism_kernel_proof_ref: Optional[str] = None
    costguard_band_summary: Optional[str] = None
    watermark: Optional[str] = None
    generated_at: Optional[str] = None

class ActionItemRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action_id: str
    severity: str
    shipment_ref: Optional[str] = None
    line_id: Optional[str] = None
    issue_type: str
    required_action: str
    owner_role: Optional[str] = None
    status: Optional[str] = None
    prism_kernel_proof_ref: Optional[str] = None

class FinalReconRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    currency: str
    shipment_ref: Optional[str] = None
    invoice_total: float
    reviewed_total: float
    variance: float
    variance_pct: float
    recon_status: str
    evidence_ref: Optional[str] = None

class LineViewRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    shipment_ref: Optional[str] = None
    description: str
    for_charge_component: Optional[str] = None
    type_b: Optional[str] = None
    amount: float
    currency: str
    rate_source: Optional[str] = None
    rate_status: Optional[str] = None
    validity_status: Optional[str] = None
    evidence_status: Optional[str] = None
    gate_status: Optional[str] = None
    band: Optional[str] = None
    delta_pct: Optional[float] = None
    numeric_integrity_status: Optional[str] = None
    difference: Optional[float] = None

class SourceDataRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    file_id: str
    source_ref: Optional[str] = None
    original_text: Optional[str] = None
    normalized_value: Optional[str] = None
    confidence: Optional[float] = None
    routing_pattern: Optional[str] = None
    # P3C PDF source + SHPT port from 01_DSV_SHPT (reviewer pdf_source_data full pop + SHPT 특화)
    pdf_page: Optional[int] = None
    text_span_hash: Optional[str] = None
    # SHPT specific (from rules_enhanced, joiners, enhanced_audit: doc mapping, gates, portal)
    doc_type: Optional[str] = None  # BOE, DO, DN, CarrierInvoice etc.
    shipment_id: Optional[str] = None  # HVDC-ADOPT-xxx or similar
    gate_score: Optional[float] = None
    gate_status: Optional[str] = None
    is_portal_fee: Optional[bool] = None

class AuditDetailRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    rule_id: str
    reason_code: str
    sct_trace_id: str
    cf_mcp_tool: Optional[str] = None
    cf_mcp_latency_ms: Optional[float] = None
    confidence: Optional[float] = None
    decision_input: Optional[str] = None
    fx_override: Optional[str] = None
    fx_policy_id: Optional[str] = None

class EvidenceIssuesRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    required_evidence: Optional[str] = None
    matched_evidence: Optional[str] = None
    gap_type: Optional[str] = None
    severity: str
    action_item_id: Optional[str] = None
    human_gate_trigger_id: Optional[str] = None

class HeaderCheckRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    field_name: str
    expected_value: Optional[str] = None
    actual_value: Optional[str] = None
    match_status: str
    severity: Optional[str] = None

class DuplicateCheckRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    invoice_no_hash: str
    vendor_hash: str
    amount_hash: Optional[str] = None
    issue_date_hash: Optional[str] = None
    match_type: str
    severity: str
    matched_job_id: Optional[str] = None

class RateCheckRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    charge_code: Optional[str] = None
    lane: Optional[str] = None
    contract_rate: Optional[float] = None
    invoiced_rate: Optional[float] = None
    rate_basis: Optional[str] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    rate_status: str
    delta_pct: Optional[float] = None
    severity: str

class TaxFxCheckRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    currency: str
    vat_rate: Optional[float] = None
    vat_amount: Optional[float] = None
    fx_rate_applied: Optional[float] = None
    fx_policy_id: Optional[str] = None
    tax_status: str
    fx_status: str
    severity: str

class ShipmentMatchRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    shipment_ref: Optional[str] = None
    job_number: Optional[str] = None
    bl_number: Optional[str] = None
    do_number: Optional[str] = None
    po_number: Optional[str] = None
    match_status: str
    matched_fields: Optional[str] = None
    severity: str

class ManifestEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: str
    value: str

class ExportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    decision_rows: list[DecisionRow]
    action_items_rows: list[ActionItemRow]
    final_recon_rows: list[FinalReconRow]
    header_check_rows: list[HeaderCheckRow] = Field(default_factory=list)
    line_view_rows: list[LineViewRow]
    duplicate_check_rows: list[DuplicateCheckRow] = Field(default_factory=list)
    rate_check_rows: list[RateCheckRow] = Field(default_factory=list)
    tax_fx_check_rows: list[TaxFxCheckRow] = Field(default_factory=list)
    shipment_match_rows: list[ShipmentMatchRow] = Field(default_factory=list)
    source_data_rows: list[SourceDataRow]
    audit_detail_rows: list[AuditDetailRow]
    evidence_issues_rows: list[EvidenceIssuesRow]
    manifest_entries: list[ManifestEntry] = Field(default_factory=list)
    generated_at: Optional[str] = None

class SheetManifest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    sheet_name: str
    row_count: int

class WorkbookManifest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    sha256: str
    size_bytes: int
    sheets: list[SheetManifest]
    generated_at: str

class ExportResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    job_id: str
    manifest: WorkbookManifest
    file_content_base64: str

def normalize_line_id(file_id: str, sheet: str, row: int, col: int) -> str:
    h = hashlib.sha1(f"{file_id}|{sheet}|{row}|{col}".encode()).hexdigest()[:12]
    return f"line_{h}"
