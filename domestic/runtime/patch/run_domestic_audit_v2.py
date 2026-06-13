
import os, json, sys, re
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
import pandas as pd
# Add parent directory to path for importing _r modules
sys.path.insert(0, str(Path(__file__).parent.parent))
from domestic_validator_v2_r import (
    load_executed_rate_ledger,
    map_supporting_documents,
    validate_domestic,
)

# LaneMatcher import for loading LaneMap data
try:
    from lane_matcher_costguard_r import load_lane_rows
    LANE_MATCHER_AVAILABLE = True
except ImportError:
    LANE_MATCHER_AVAILABLE = False

# 월별 설정 매핑
MONTH_CONFIG = {
    "sept": {
        "month_num": "09",
        "month_name": "SEPTEMBER",
        "month_name_short": "Sept",
        "year": "2025",
        "folder": "DSV 202509",
        "excel_pattern": "SCNT HVDC DRAFT INVOICE FOR DOMESTIC DELIVERY SEPTEMBER 2025.xlsx",
        "docs_folder": "SCNT Domestic (Sept 2025) - Supporting Documents"
    },
    "nov": {
        "month_num": "11",
        "month_name": "NOVEMBER",
        "month_name_short": "Nov",
        "year": "2025",
        "folder": "DSV 202511",
        "excel_pattern": "SCNT HVDC DRAFT INVOICE FOR DOMESTIC DELIVERY NOVEMBER 2025.xlsx",
        "docs_folder": "SCNT (Domestic Deliveries) Supporting Documnets - November 2025"
    },
    "dec": {
        "month_num": "12",
        "month_name": "DECEMBER",
        "month_name_short": "Dec",
        "year": "2025",
        "folder": "DSV 202512",
        "excel_pattern": "SCNT HVDC DRAFT INVOICE FOR DOMESTIC DELIVERY DECEMBER 2025.xlsx",
        "docs_folder": "Samsung C&T (HVDC) Domestic Deliveries SuppDocs - Dec 2025"
    },
    "jan": {
        "month_num": "01",
        "month_name": "JANUARY",
        "month_name_short": "Jan",
        "year": "2026",
        "folder": "DSV202601",
        "excel_pattern": "SCNT HVDC DRAFT INVOICE FOR DOMESTIC DELIVERY JANUARY 2026.xlsx",
        "docs_folder": ""
    },
    "feb": {
        "month_num": "02",
        "month_name": "FEBRUARY",
        "month_name_short": "Feb",
        "year": "2026",
        "folder": "DSV 202602",
        "excel_pattern": "SCNT HVDC DRAFT INVOICE FOR DOMESTIC DELIVERY FEBRUARY 2026_1.xlsx",
        "docs_folder": "SCNT (Domestic & Export) Supporting Documents - February 2026"
    },
    "apr": {
        "month_num": "04",
        "month_name": "APRIL",
        "month_name_short": "Apr",
        "year": "2026",
        "folder": "APRIL 2026",
        "excel_pattern": "DOMESTIC.xlsx",
        "docs_folder": ""
    }
}

def find_header_and_load(file_path):
    """Excel 파일의 헤더 행을 자동으로 찾아서 로드합니다."""
    if str(file_path).lower().endswith('.csv'):
        return pd.read_csv(file_path)
        
    xl = pd.ExcelFile(file_path)
    target_sheet = xl.sheet_names[0]
    
    # 헤더 찾기 (최대 30행 검색)
    df_preview = pd.read_excel(file_path, sheet_name=target_sheet, header=None, nrows=30)
    
    header_idx = 0
    max_score = 0
    
    # 주요 키워드가 많이 포함된 행을 헤더로 간주
    keywords = ['S/N', 'Shipment', 'Loading', 'Delivery', 'Vehicle', 'Rate', 'Amount', 'Total', 'Trips']
    
    for idx, row in df_preview.iterrows():
        row_str = ' '.join([str(x) for x in row if pd.notna(x)])
        score = sum(1 for k in keywords if k.lower() in row_str.lower())
        if score > max_score:
            max_score = score
            header_idx = idx
            
    print(f"[INFO] Detected header at row {header_idx + 1}")
    # 헤더가 발견된 행으로 다시 로드
    return pd.read_excel(file_path, sheet_name=target_sheet, header=header_idx)

def _normalize_col_key(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")

def _to_number(value):
    if value is None:
        return float("nan")
    try:
        if pd.isna(value):
            return float("nan")
    except Exception:
        pass
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned or not re.search(r"\d", cleaned):
            return float("nan")
        cleaned = re.sub(r"[^0-9.\-]", "", cleaned.replace(",", ""))
        if cleaned in {"", ".", "-", "-."}:
            return float("nan")
        value = cleaned
    try:
        return float(value)
    except Exception:
        return float("nan")

def normalize_invoice_columns(df):
    """컬럼명을 유연하게 표준화합니다 (공백, 대소문자 무시)."""
    col_map = {}
    
    # 표준 컬럼명 정의 (Target -> Candidates)
    targets = {
        'origin': ['Place of Loading', 'Origin', 'Loading Place', 'POL'],
        'destination': ['Place of Delivery', 'Destination', 'Delivery Place', 'POD'],
        'vehicle': ['Vehicle Type', 'Vehicle', 'Truck Type'],
        'rate_usd': ['Rate (US$)', 'Rate (USD)', 'Rate USD', 'USD Rate', 'Invoice Rate USD', 'Rate(USD)', 'Rate', 'Unit Rate', 'Price'],
        'distance_km': ['Distance(km)', 'Distance', 'KM', 'Dist', 'Distance (km)'],
        'qty': ['Q/TY', '# Trips', 'QTY', 'Quantity', 'Trips', 'No of Trips'],
        'shipment_ref': ['Shipment Reference', 'Shipment Reference#', 'Ref', 'Reference', 'Shipment Ref'],
        'amount_usd': ['Amount (USD)', 'Amount', 'Total (USD)', 'Total'],
        'date': ['Date', 'Invoice Date']
    }
    
    # 현재 컬럼명 정규화 맵 (stripped string -> original column)
    current_cols = {str(c).strip(): c for c in df.columns}
    
    for target, candidates in targets.items():
        # 이미 존재하는지 확인
        if target in df.columns:
            continue
        
        # 매칭된 컬럼 찾기
        matched_col = None
        for cand in candidates:
            # 대소문자 무시 및 공백 제거 매칭
            for cur_col_clean, cur_col_original in current_cols.items():
                if cand.lower() == cur_col_clean.lower():
                    matched_col = cur_col_original
                    break
                # 부분 일치 (예: "Rate (USD)" vs "Rate(USD)")
                if cand.lower().replace(" ", "") == cur_col_clean.lower().replace(" ", ""):
                    matched_col = cur_col_original
                    break
            if matched_col:
                break
        
        # 매칭된 컬럼이 있고, 아직 매핑되지 않았으면 추가
        if matched_col and matched_col not in col_map:
            col_map[matched_col] = target
    
    # 컬럼 이름 변경
    out = df.rename(columns=col_map)

    usd_col = _find_existing_column(
        df,
        ["Rate (US$)", "Rate (USD)", "Rate USD", "USD Rate", "Invoice Rate USD", "rate_usd"],
    )
    aed_col = _find_existing_column(
        df,
        ["Rate (AED)", "Rate AED", "AED Rate", "Invoice Rate AED", "rate_aed"],
    )
    if usd_col and "rate_usd_input" not in out.columns:
        out["rate_usd_input"] = df[usd_col]
    if aed_col and "rate_aed_input" not in out.columns:
        out["rate_aed_input"] = df[aed_col]

    return out

def _find_existing_column(df, candidates):
    clean_map = {}
    for col in df.columns:
        clean_map.setdefault(_normalize_col_key(col), col)
    for candidate in candidates:
        if candidate in df.columns:
            return candidate
        key = _normalize_col_key(candidate)
        if key in clean_map:
            return clean_map[key]
    return None

def ensure_rate_usd_from_numeric_columns(df, fx_rate=3.6725):
    """Use numeric USD rate first; otherwise derive it from Rate (AED)."""
    out = df.copy()
    rate_usd_col = _find_existing_column(
        out,
        ["rate_usd_input", "Rate (US$)", "Rate (USD)", "Rate USD", "USD Rate", "rate_usd"],
    )
    if rate_usd_col:
        rate_usd = out[rate_usd_col].map(_to_number).astype("float64")
    else:
        rate_usd = pd.Series(float("nan"), index=out.index, dtype="float64")

    rate_aed_col = _find_existing_column(
        out,
        ["rate_aed_input", "Rate (AED)", "Rate(AED)", "Rate AED", "AED Rate", "rate_aed"],
    )
    if rate_aed_col:
        rate_aed = out[rate_aed_col].map(_to_number).astype("float64")
        rate_usd = rate_usd.where(rate_usd.notna(), rate_aed / float(fx_rate))

    out["rate_usd"] = pd.to_numeric(rate_usd, errors="coerce")
    return out

def _first_non_blank(row, columns):
    for col in columns:
        if col not in row.index:
            continue
        value = row.get(col)
        try:
            if pd.isna(value):
                continue
        except Exception:
            pass
        text = str(value).strip()
        if text:
            return value
    return ""

def _join_unique_text(values):
    seen = []
    for value in values:
        try:
            if pd.isna(value):
                continue
        except Exception:
            pass
        text = str(value).strip()
        if text and text not in seen:
            seen.append(text)
    return ", ".join(seen)

def build_executed_lane_reference(df):
    columns = [
        "Lane_ID",
        "Lane_Key",
        "Rate_USD",
        "Method",
        "Executed_Method",
        "Sample_Count",
        "Source",
        "Source_Rows",
        "Shipment_Count",
        "Shipment_Refs",
    ]
    if df is None or "ref_lane_id" not in df.columns:
        return pd.DataFrame(columns=columns)

    lane_ids = df["ref_lane_id"].astype(str).str.strip()
    exec_mask = lane_ids.str.startswith("EXEC-LANE-", na=False)
    if not exec_mask.any():
        return pd.DataFrame(columns=columns)

    ref_rows = []
    work = df.loc[exec_mask].copy()
    work["_exec_lane_id"] = lane_ids.loc[exec_mask]

    for lane_id, group in work.groupby("_exec_lane_id", sort=False):
        first = group.iloc[0]
        ref_rows.append(
            {
                "Lane_ID": lane_id,
                "Lane_Key": _first_non_blank(first, ["ref_lane_key", "executed_ref_lane_key"]),
                "Rate_USD": _first_non_blank(first, ["ref_rate_usd", "executed_ref_rate_usd"]),
                "Method": _first_non_blank(first, ["executed_ref_method", "ref_method"]),
                "Executed_Method": _first_non_blank(first, ["executed_ref_method"]),
                "Sample_Count": _first_non_blank(first, ["executed_ref_sample_count"]),
                "Source": _first_non_blank(first, ["executed_ref_source"]),
                "Source_Rows": _first_non_blank(first, ["executed_ref_source_rows"]),
                "Shipment_Count": len(group),
                "Shipment_Refs": _join_unique_text(group["shipment_ref"]) if "shipment_ref" in group.columns else "",
            }
        )

    return pd.DataFrame(ref_rows, columns=columns)

def _lane_id_row_map(reference_df):
    lane_id_to_row = {}
    if reference_df is None or reference_df.empty or "Lane_ID" not in reference_df.columns:
        return lane_id_to_row
    for idx, lane_id in enumerate(reference_df["Lane_ID"], start=1):
        if pd.notna(lane_id) and str(lane_id).strip():
            lane_id_to_row[str(lane_id).strip()] = idx + 1
    return lane_id_to_row


# ---------------------------------------------------------------------------
# Fixed GPTS Audit Items Excel output format (patched 2026-06-07)
# ---------------------------------------------------------------------------
# The user-supplied DOMESTIC_SHEET_FORMAT.json is the contract for final
# workbook output.  "items" must always keep this exact column order.  Price /
# rate cells must keep clickable links to the approved/executed rate source.
FIXED_ITEMS_COLUMNS = ['S/N', 'shipment_ref', 'Job #', 'Operation Type', 'origin', 'destination', 'qty', 'vehicle', 'Applied rate', 'Rate (AED)', 'rate_usd', 'Amount (US$)', 'Total (US$)', 'rate_usd_input', 'rate_aed_input', 'distance_km', 'unit', 'origin_norm', 'origin_norm_source', 'destination_norm', 'destination_norm_source', 'ref_rate_usd', 'ref_method', 'ref_lane_alias', 'ref_lane_id', 'ref_lane_key', 'ref_confidence', 'ref_origin_norm', 'ref_dest_norm', 'ref_vehicle_norm', 'executed_ref_rate_usd', 'executed_ref_method', 'executed_ref_delta_pct', 'executed_ref_sample_count', 'executed_ref_source', 'executed_ref_verdict', 'executed_ref_lane_key', 'executed_ref_lane_id', 'executed_ref_source_rows', 'delta_pct', 'cg_band', 'special_status', 'verdict', 'anomaly', 'short_run_flag', 'fixed_cost_suspect', 'risk_score', 'rbr_trigger', 'supporting_docs_list', 'evidence_count', 'evidence_types', 'has_dn', 'pdf_dn_number', 'pdf_issue_date', 'pdf_origin', 'pdf_destination', 'pdf_content_summary', 'pdf_extracted_fields']

PRICE_LINK_COLUMNS = [
    "Rate (AED)",
    "rate_usd",
    "Amount (US$)",
    "Total (US$)",
    "rate_usd_input",
    "rate_aed_input",
    "ref_rate_usd",
    "executed_ref_rate_usd",
]

MONEY_COLUMNS = [
    "Rate (AED)",
    "rate_usd",
    "Amount (US$)",
    "Total (US$)",
    "rate_usd_input",
    "rate_aed_input",
    "ref_rate_usd",
    "executed_ref_rate_usd",
]

PCT_COLUMNS = ["executed_ref_delta_pct", "delta_pct"]
COUNT_COLUMNS = ["S/N", "qty", "distance_km", "executed_ref_sample_count", "risk_score", "evidence_count"]

def coerce_fixed_items_schema(df):
    """Return df with the fixed GPTS items column order.

    Missing columns are created as blank. Extra columns are intentionally not
    written to the items sheet so the workbook remains stable for downstream
    Excel/Skill automation.
    """
    out = df.copy()
    for col in FIXED_ITEMS_COLUMNS:
        if col not in out.columns:
            out[col] = ""
    return out[FIXED_ITEMS_COLUMNS].copy()

def _is_blank_like(value):
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    return str(value).strip() == ""

def _display_for_cell(value, numeric=False, pct=False):
    if _is_blank_like(value):
        return ""
    if pct:
        try:
            return f"{float(value):.2%}"
        except Exception:
            return str(value)
    if numeric:
        try:
            return f"{float(str(value).replace(',', '')):,.2f}"
        except Exception:
            return str(value)
    return str(value)

def _write_link_formula_or_value(ws, row, col, value, target_sheet, target_cell, cell_format=None, numeric=False, pct=False):
    display = _display_for_cell(value, numeric=numeric, pct=pct)
    if display and target_sheet and target_cell:
        # Use an actual internal hyperlink object instead of a HYPERLINK()
        # formula.  The GPT runner appends self_check with openpyxl, and
        # openpyxl re-save can strip formula cached values; actual hyperlinks
        # preserve both the visible ref/rate value and click target.
        ws.write_url(
            row,
            col,
            f"internal:'{target_sheet}'!{target_cell}",
            cell_format,
            string=display,
        )
    else:
        ws.write(row, col, value, cell_format)

def _apply_fixed_workbook_format(writer, items_df, summary_band, summary_verdict, lane_map_ref=None, executed_lane_ref=None):
    """Apply workbook-wide fixed GPTS Excel style.

    Contract:
    - Calibri 10
    - horizontal center / vertical middle
    - no wrap text
    - numeric formats 1,234.00 / 123.00
    - date format yyyy-mm-dd
    - autofit-like bounded column widths
    - clickable price/rate links must remain in items sheet
    """
    workbook = writer.book
    base_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "text_wrap": False,
    })
    header_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "bold": True,
        "align": "center",
        "valign": "vcenter",
        "text_wrap": False,
    })
    money_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "num_format": "#,##0.00",
        "text_wrap": False,
    })
    pct_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "num_format": "0.00%",
        "text_wrap": False,
    })
    link_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "font_color": "#0563C1",
        "underline": 1,
        "text_wrap": False,
    })
    money_link_fmt = workbook.add_format({
        "font_name": "Calibri",
        "font_size": 10,
        "align": "center",
        "valign": "vcenter",
        "num_format": "#,##0.00",
        "font_color": "#0563C1",
        "underline": 1,
        "text_wrap": False,
    })

    def _format_sheet(sheet_name, df_like=None):
        if sheet_name not in writer.sheets:
            return
        ws = writer.sheets[sheet_name]
        rows = 1 if df_like is None else max(1, len(df_like) + 1)
        cols = 1 if df_like is None else max(1, len(getattr(df_like, "columns", [])))
        ws.set_default_row(18)
        ws.freeze_panes(1, 0)
        ws.autofilter(0, 0, max(0, rows - 1), max(0, cols - 1))
        ws.set_row(0, 20, header_fmt)
        if df_like is not None:
            for c_idx, col_name in enumerate(df_like.columns):
                col_values = [str(col_name)]
                try:
                    col_values.extend(df_like[col_name].head(200).astype(str).fillna("").tolist())
                except Exception:
                    pass
                width = max(len(v) for v in col_values if v is not None) if col_values else 10
                width = min(max(width + 2, 10), 36)
                fmt = money_fmt if col_name in MONEY_COLUMNS else (pct_fmt if col_name in PCT_COLUMNS else base_fmt)
                ws.set_column(c_idx, c_idx, width, fmt)

    _format_sheet("items", items_df)
    _format_sheet("summary_band", summary_band)
    _format_sheet("summary_verdict", summary_verdict)
    _format_sheet("lane_map_reference", lane_map_ref)
    _format_sheet("executed_lane_reference", executed_lane_ref)

    return {
        "base_fmt": base_fmt,
        "header_fmt": header_fmt,
        "money_fmt": money_fmt,
        "pct_fmt": pct_fmt,
        "link_fmt": link_fmt,
        "money_link_fmt": money_link_fmt,
    }

def _safe_sheet_ref(sheet_name):
    return str(sheet_name).replace("'", "''")

def _add_lane_and_price_hyperlinks(writer, items_df, approved_lane_id_to_row, executed_lane_id_to_row, formats):
    """Add hyperlinks to both ref_lane_id and all price/rate cells.

    - ref_lane_id links to the matched reference row.
    - price/rate cells link directly to the matched Rate_USD cell in the
      lane reference sheet.
    """
    if "items" not in writer.sheets or "ref_lane_id" not in items_df.columns:
        return {"approved": 0, "executed": 0, "lane_id_links": 0, "price_links": 0, "total": 0}

    ws_items = writer.sheets["items"]
    cols = list(items_df.columns)
    ref_lane_id_col_idx = cols.index("ref_lane_id")
    price_col_indices = [cols.index(c) for c in PRICE_LINK_COLUMNS if c in cols]
    linked_counts = {"approved": 0, "executed": 0, "lane_id_links": 0, "price_links": 0, "total": 0}

    for excel_row_idx, (_, row) in enumerate(items_df.iterrows(), start=1):
        lane_id = row.get("ref_lane_id", "")
        if _is_blank_like(lane_id):
            continue
        lane_id_text = str(lane_id).strip()

        if lane_id_text in approved_lane_id_to_row:
            target_sheet = "lane_map_reference"
            target_row = approved_lane_id_to_row[lane_id_text]
            target_id_cell = f"A{target_row}"
            target_rate_cell = f"F{target_row}"
            link_type = "approved"
        elif lane_id_text in executed_lane_id_to_row:
            target_sheet = "executed_lane_reference"
            target_row = executed_lane_id_to_row[lane_id_text]
            target_id_cell = f"A{target_row}"
            target_rate_cell = f"C{target_row}"
            link_type = "executed"
        else:
            continue

        target_sheet_safe = _safe_sheet_ref(target_sheet)
        ws_items.write_url(
            excel_row_idx,
            ref_lane_id_col_idx,
            f"internal:'{target_sheet_safe}'!{target_id_cell}",
            formats["link_fmt"],
            string=lane_id_text,
        )
        linked_counts["lane_id_links"] += 1
        linked_counts[link_type] += 1
        linked_counts["total"] += 1

        for col_idx in price_col_indices:
            col_name = cols[col_idx]
            value = row.get(col_name, "")
            if _is_blank_like(value):
                continue
            _write_link_formula_or_value(
                ws_items,
                excel_row_idx,
                col_idx,
                value,
                target_sheet_safe,
                target_rate_cell,
                formats["money_link_fmt"],
                numeric=(col_name in MONEY_COLUMNS),
                pct=False,
            )
            linked_counts["price_links"] += 1

    return linked_counts

def write_fixed_excel_report(xlsx_path, df, summary_band, summary_verdict, lane_map_ref):
    """Write the fixed GPTS Excel report and return hyperlink counts."""
    items_df = coerce_fixed_items_schema(df)
    with pd.ExcelWriter(xlsx_path, engine="xlsxwriter") as w:
        items_df.to_excel(w, sheet_name="items", index=False)
        summary_band.to_excel(w, sheet_name="summary_band", index=False)
        summary_verdict.to_excel(w, sheet_name="summary_verdict", index=False)

        approved_lane_id_to_row = {}
        executed_lane_id_to_row = {}
        if lane_map_ref is not None and not lane_map_ref.empty:
            lane_map_ref.to_excel(w, sheet_name="lane_map_reference", index=False)
            approved_lane_id_to_row = _lane_id_row_map(lane_map_ref)
        else:
            pd.DataFrame(columns=["Lane_ID", "Origin", "Destination", "Vehicle", "Unit", "Rate_USD", "Notes"]).to_excel(
                w, sheet_name="lane_map_reference", index=False
            )

        executed_lane_ref = build_executed_lane_reference(items_df)
        if not executed_lane_ref.empty:
            executed_lane_ref.to_excel(w, sheet_name="executed_lane_reference", index=False)
            executed_lane_id_to_row = _lane_id_row_map(executed_lane_ref)

        fmts = _apply_fixed_workbook_format(w, items_df, summary_band, summary_verdict, lane_map_ref, executed_lane_ref)
        link_counts = _add_lane_and_price_hyperlinks(
            w, items_df, approved_lane_id_to_row, executed_lane_id_to_row, fmts
        )

        # Hidden contract sheet helps future GPTs/Skill runs verify the exact
        # fixed output schema without guessing.
        contract_df = pd.DataFrame({"ordinal": list(range(1, len(FIXED_ITEMS_COLUMNS) + 1)), "field_name": FIXED_ITEMS_COLUMNS})
        contract_df.to_excel(w, sheet_name="_format_contract", index=False)
        ws_contract = w.sheets["_format_contract"]
        ws_contract.hide()

    return link_counts, items_df


def generate_pdf_report(df, output_path, recap_card):
    """Generates a simple PDF report using reportlab."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors

        doc = SimpleDocTemplate(output_path, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        # Title
        story.append(Paragraph("Domestic Invoice Audit Report", styles['Title']))
        story.append(Spacer(1, 12))

        # Recap
        story.append(Paragraph("Recap Card", styles['Heading2']))
        for line in recap_card:
            story.append(Paragraph(line, styles['Normal']))
        story.append(Spacer(1, 12))

        # Summary Table
        story.append(Paragraph("Summary Statistics", styles['Heading2']))
        
        # Calculate stats
        total = len(df)
        verified = len(df[df['verdict'] == 'VERIFIED'])
        pending = len(df[df['verdict'] == 'PENDING_REVIEW'])
        fail = len(df[df['verdict'] == 'FAIL'])
        
        data = [
            ['Metric', 'Count', 'Percentage'],
            ['Total Items', str(total), '100%'],
            ['Verified', str(verified), f"{verified/total*100:.1f}%" if total else "0%"],
            ['Pending Review', str(pending), f"{pending/total*100:.1f}%" if total else "0%"],
            ['Fail', str(fail), f"{fail/total*100:.1f}%" if total else "0%"]
        ]

        t = Table(data)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        story.append(t)
        
        doc.build(story)
        print(f"[OK] PDF Report generated: {output_path}")
        return True

    except ImportError:
        print("[WARN] 'reportlab' library not found. Skipping PDF report generation.")
        print("   Install it via: pip install reportlab")
        return False
    except Exception as e:
        print(f"[FAIL] Failed to generate PDF report: {e}")
        return False

def main():
    import argparse
    
    # 스크립트 위치 기준으로 기본 경로 설정
    script_dir = Path(__file__).parent
    root_dir = script_dir.parent  # 02_DSV_DOMESTIC
    data_dir = root_dir / "Data"
    
    ap = argparse.ArgumentParser(
        description="Domestic Invoice Audit v2 - Monthly Selection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python run_domestic_audit_v2.py --month nov
  python run_domestic_audit_v2.py --month sept
  python run_domestic_audit_v2.py --month dec
  python run_domestic_audit_v2.py --month apr
  python run_domestic_audit_v2.py --invoice "path/to/invoice.xlsx" --mapping "path/to/mapping.xlsx"
        """
    )
    
    # 월별 선택 옵션
    ap.add_argument(
        "--month",
        type=str,
        choices=list(MONTH_CONFIG.keys()),
        default=None,
        help=f"월 선택 ({', '.join(MONTH_CONFIG.keys())}) - 선택 시 자동 경로 구성"
    )
    
    # 개별 경로 옵션 (하위 호환성 및 수동 지정용)
    ap.add_argument("--invoice", default=None, help="Path to invoice Excel file (or CSV)")
    ap.add_argument("--mapping", default=None, help="Path to mapping Excel file")
    ap.add_argument("--ledger", default=None, help="Path to executed ledger JSON or Excel file")
    ap.add_argument("--config", default=None, help="Path to config JSON file")
    ap.add_argument("--outdir", default=None, help="Output directory")
    ap.add_argument("--docs", default=None, help="Path to supporting documents folder (optional)")
    
    args = ap.parse_args()
    
    # 월별 선택 모드: 자동 경로 구성
    if args.month:
        if args.month not in MONTH_CONFIG:
            print(f"[ERROR] Unsupported month: {args.month}")
            print(f"   Supported months: {', '.join(MONTH_CONFIG.keys())}")
            return
        
        config = MONTH_CONFIG[args.month]
        month_display = config['month_name']
        year = config['year']
        
        print(f"[DOMESTIC] Enhanced {month_display} {year} Invoice Audit System")
        print("=" * 80)
        
        # 자동 경로 구성
        data_folder = data_dir / config["folder"]
        invoice_file = data_folder / config["excel_pattern"]
        docs_folder = data_folder / config["docs_folder"]
        output_dir = root_dir / "Results" / f"{config['month_name_short']}_{config['year']}"
        
        # 기본 파일 경로
        if args.mapping is None:
            args.mapping = str(data_dir / "DOMESTIC_with_distances.xlsx")
        if args.ledger is None:
            default_ledger = data_dir / "domestic_rate_ledger.json"
            args.ledger = str(default_ledger if default_ledger.exists() else root_dir / "domestic_result.xlsx")
        if args.config is None:
            args.config = str(script_dir / "config_domestic_v2.json")
        if args.outdir is None:
            args.outdir = str(output_dir)
        if args.docs is None:
            args.docs = str(docs_folder) if docs_folder.exists() else None
        if args.invoice is None:
            args.invoice = str(invoice_file)
        
        print(f"Invoice: {args.invoice}")
        print(f"Mapping: {args.mapping}")
        print(f"Ledger: {args.ledger}")
        print(f"Config: {args.config}")
        print(f"Output: {args.outdir}")
        if args.docs:
            print(f"Documents: {args.docs}")
        print("=" * 80)
    
    # 수동 모드: 필수 인자 확인
    else:
        if not args.invoice:
            print("[ERROR] --invoice or --month is required.")
            ap.print_help()
            return
        
        # 기본 경로 설정 (상대 경로 기준)
        if args.mapping is None:
            args.mapping = str(data_dir / "DOMESTIC_with_distances.xlsx")
        if args.ledger is None:
            default_ledger = data_dir / "domestic_rate_ledger.json"
            args.ledger = str(default_ledger if default_ledger.exists() else root_dir / "domestic_result.xlsx")
        if args.config is None:
            args.config = str(script_dir / "config_domestic_v2.json")
        if args.outdir is None:
            args.outdir = str(root_dir / "Results" / "Sept_2025_v2")

    # 경로 정규화 (상대 경로를 절대 경로로 변환)
    args.invoice = str(Path(args.invoice).resolve())
    args.mapping = str(Path(args.mapping).resolve()) if args.mapping else None
    args.ledger = str(Path(args.ledger).resolve()) if args.ledger else None
    args.config = str(Path(args.config).resolve()) if args.config else None
    args.outdir = str(Path(args.outdir).resolve())
    args.docs = str(Path(args.docs).resolve()) if args.docs else None
    
    os.makedirs(args.outdir, exist_ok=True)
    
    # 파일 존재 확인
    if not os.path.exists(args.invoice):
        print(f"[ERROR] Invoice file not found: {args.invoice}")
        return
    
    if args.mapping and not os.path.exists(args.mapping):
        print(f"[WARN] Mapping file not found: {args.mapping}")
        args.mapping = None
    
    if args.ledger and not os.path.exists(args.ledger):
        print(f"[WARN] Ledger file not found: {args.ledger}")
        args.ledger = None
    
    if args.config and not os.path.exists(args.config):
        print(f"[ERROR] Config file not found: {args.config}")
        return

    # Load inputs with smart header detection
    print("Loading invoice data...")
    inv_df = find_header_and_load(args.invoice)
    
    # Normalize column names robustly
    inv_df = normalize_invoice_columns(inv_df)
    inv_df = ensure_rate_usd_from_numeric_columns(inv_df)
    
    # Check mapped columns
    mapped_cols = [c for c in inv_df.columns if c in ['origin', 'destination', 'vehicle', 'rate_usd', 'shipment_ref']]
    print(f"[OK] Mapped columns: {mapped_cols}")
    
    if 'rate_usd' not in inv_df.columns:
        print("[WARN] 'rate_usd' column not found! Verification will likely fail.")
    
    # Add distance_km if missing (calculate or set default)
    if 'distance_km' not in inv_df.columns:
        inv_df['distance_km'] = None  # Will be calculated or left as None
    
    # Add qty if missing
    if 'qty' not in inv_df.columns:
        inv_df['qty'] = 1.0
    
    # Add unit column if missing
    if 'unit' not in inv_df.columns:
        inv_df['unit'] = 'per truck'

    # Ledger optional
    ledger_df = None
    if args.ledger and os.path.exists(args.ledger):
        try:
            ledger_df = load_executed_rate_ledger(args.ledger)
            print(f"[OK] Executed ledger loaded: {args.ledger}")
        except Exception as e:
            print(f"[WARN] Executed ledger load failed: {e}")
            ledger_df = None

    # Supporting documents mapping (optional)
    supporting_docs = None
    if args.docs:
        docs_path = Path(args.docs)
        if docs_path.exists():
            # Get unique shipment_refs from invoice for filtering
            shipment_refs = inv_df["shipment_ref"].dropna().unique().tolist() if "shipment_ref" in inv_df.columns else None
            supporting_docs = map_supporting_documents(docs_path, shipment_refs)
            print(f"Mapped {len(supporting_docs)} shipment references to supporting documents")
            total_docs = sum(len(docs) for docs in supporting_docs.values())
            print(f"Total PDF files mapped: {total_docs}")

    df, recap, artifact, proof_hash = validate_domestic(
        invoice_df=inv_df,
        mapping_path=args.mapping,
        config_path=args.config,
        executed_ledger_df=ledger_df,
        supporting_docs=supporting_docs
    )

    # Fixed export schema before writing any user-facing item artifact.
    df_items_export = coerce_fixed_items_schema(df)

    # Export (write to temp then replace; if items.csv is open, save as items_YYYYMMDD_HHMMSS.csv)
    items_path = os.path.join(args.outdir, "items.csv")
    items_tmp = items_path + ".tmp"
    df_items_export.to_csv(items_tmp, index=False)
    try:
        os.replace(items_tmp, items_path)
    except (PermissionError, OSError):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        alt_path = os.path.join(args.outdir, f"items_{ts}.csv")
        try:
            os.rename(items_tmp, alt_path)
            print(f"[WARN] {os.path.basename(items_path)} is in use. Saved as {os.path.basename(alt_path)}")
        except OSError:
            os.remove(items_tmp) if os.path.exists(items_tmp) else None
            print(f"[WARN] Could not overwrite {items_path} or save alternate. Data was not written.")
        items_path = alt_path if os.path.exists(alt_path) else items_path

    # Summaries
    summary_band = df.groupby("cg_band").size().reset_index(name="count")
    summary_verdict = df.groupby("verdict").size().reset_index(name="count")

    # Load LaneMap reference data for hyperlinks
    lane_map_ref = None
    if LANE_MATCHER_AVAILABLE and "ref_lane_id" in df.columns:
        try:
            generator_dir = root_dir / "SCNT HVDC Domestic Invoice v2.2 Generator"
            data_dir = root_dir / "Data"

            lanemap_candidates = [
                root_dir / "ApprovedLaneMap_ENHANCED.json",
                generator_dir / "ApprovedLaneMap_ENHANCED.json",
                data_dir / "ApprovedLaneMap_ENHANCED.json"
            ]

            lanemap_path = None
            for candidate in lanemap_candidates:
                if candidate.exists():
                    lanemap_path = candidate
                    break

            if lanemap_path:
                lane_rows = load_lane_rows(str(lanemap_path))
                lane_data = []
                for row in lane_rows:
                    lane_data.append({
                        "Lane_ID": row.lane_id,
                        "Origin": row.origin,
                        "Destination": row.destination,
                        "Vehicle": row.vehicle,
                        "Unit": row.unit,
                        "Rate_USD": row.median_rate_usd,
                        "Notes": row.notes
                    })
                lane_map_ref = pd.DataFrame(lane_data)
                print(f"LaneMap reference loaded: {len(lane_map_ref)} lanes")
        except Exception as e:
            print(f"LaneMap reference load failed; continue without hyperlinks: {e}")
            lane_map_ref = None

    # Excel report (타임스탬프 추가하여 충돌 방지)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_name = "domestic_audit_report_v2"
    xlsx_path = os.path.join(args.outdir, f"{base_name}_{timestamp}.xlsx")
    
    try:
        link_counts, df_items_export = write_fixed_excel_report(
            xlsx_path, df_items_export, summary_band, summary_verdict, lane_map_ref
        )
        print(
            "Hyperlinks added: "
            f"{link_counts['total']} lane-id links "
            f"(approved={link_counts['approved']}, executed={link_counts['executed']}), "
            f"price_links={link_counts['price_links']}"
        )
    except PermissionError:
        # Retry with a different timestamp if the file is open
        timestamp2 = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        xlsx_path = os.path.join(args.outdir, f"{base_name}_{timestamp2}.xlsx")
        link_counts, df_items_export = write_fixed_excel_report(
            xlsx_path, df_items_export, summary_band, summary_verdict, lane_map_ref
        )
        print(
            "Hyperlinks added: "
            f"{link_counts['total']} lane-id links "
            f"(approved={link_counts['approved']}, executed={link_counts['executed']}), "
            f"price_links={link_counts['price_links']}"
        )
        print(f"File was in use; saved as: {os.path.basename(xlsx_path)}")
    # Proof artifact (if file open, save as domestic_audit_proof_v2_YYYYMMDD_HHMMSS.json)
    proof = {
        "recap_card": recap,
        "artifact": artifact,
        "proof_hash_sha256": proof_hash
    }
    proof_path = os.path.join(args.outdir, "domestic_audit_proof_v2.json")
    try:
        with open(proof_path, "w", encoding="utf-8") as f:
            json.dump(proof, f, ensure_ascii=False, indent=2)
    except (PermissionError, OSError):
        proof_path = os.path.join(args.outdir, f"domestic_audit_proof_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(proof_path, "w", encoding="utf-8") as f:
            json.dump(proof, f, ensure_ascii=False, indent=2)
        print(f"[WARN] domestic_audit_proof_v2.json in use. Saved as {os.path.basename(proof_path)}")

    # PDF Report (if file open, save as domestic_audit_report_v2_YYYYMMDD_HHMMSS.pdf)
    pdf_path = os.path.join(args.outdir, "domestic_audit_report_v2.pdf")
    try:
        generate_pdf_report(df, pdf_path, recap)
    except (PermissionError, OSError):
        pdf_path = os.path.join(args.outdir, f"domestic_audit_report_v2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf")
        generate_pdf_report(df, pdf_path, recap)
        print(f"[WARN] domestic_audit_report_v2.pdf in use. Saved as {os.path.basename(pdf_path)}")

    print("Exported:")
    print(" -", items_path)
    print(" -", xlsx_path)
    print(" -", proof_path)
    print(" -", pdf_path)
    print("Recap card:")
    for line in recap:
        print(line)

if __name__ == "__main__":
    main()
