from __future__ import annotations
import base64
import hashlib
from datetime import datetime
from fastapi import APIRouter
from app.schemas import ExportRequest, ExportResponse, WorkbookManifest, SheetManifest
from app.exporters.xlsx import build_xlsx

router = APIRouter()

@router.post('/export', response_model=ExportResponse)
def export_xlsx(req: ExportRequest) -> ExportResponse:
    # Use fixed timestamp if passed, else current time
    gen_time = req.generated_at or datetime.utcnow().isoformat() + "Z"
    
    xlsx_bytes = build_xlsx(req)
    
    sha256_hash = hashlib.sha256(xlsx_bytes).hexdigest()
    
    sheets_manifest = [
        SheetManifest(sheet_name="00_Decision", row_count=len(req.decision_rows)),
        SheetManifest(sheet_name="01_Action_Items", row_count=len(req.action_items_rows)),
        SheetManifest(sheet_name="02_Final_Recon", row_count=len(req.final_recon_rows)),
        SheetManifest(sheet_name="03_Header_Check", row_count=len(req.header_check_rows)),
        SheetManifest(sheet_name="04_Line_View", row_count=len(req.line_view_rows)),
        SheetManifest(sheet_name="05_Duplicate_Check", row_count=len(req.duplicate_check_rows)),
        SheetManifest(sheet_name="06_Rate_Check", row_count=len(req.rate_check_rows)),
        SheetManifest(sheet_name="07_Tax_FX_Check", row_count=len(req.tax_fx_check_rows)),
        SheetManifest(sheet_name="08_Shipment_Match", row_count=len(req.shipment_match_rows)),
        SheetManifest(sheet_name="90_Source_Data", row_count=len(req.source_data_rows)),
        SheetManifest(sheet_name="91_Audit_Detail", row_count=len(req.audit_detail_rows)),
        SheetManifest(sheet_name="92_Evidence_Issues", row_count=len(req.evidence_issues_rows)),
        SheetManifest(sheet_name="99_Manifest", row_count=5 + len(req.manifest_entries))
    ]
    
    manifest = WorkbookManifest(
        sha256=sha256_hash,
        size_bytes=len(xlsx_bytes),
        sheets=sheets_manifest,
        generated_at=gen_time
    )
    
    base64_str = base64.b64encode(xlsx_bytes).decode('utf-8')
    
    return ExportResponse(
        job_id=req.job_id,
        manifest=manifest,
        file_content_base64=base64_str
    )
