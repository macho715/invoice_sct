#!/usr/bin/env python3
"""Validate DSV 8-sheet audit workbook output.

This validator uses only Python standard library ZIP/XML parsing. It is safe for
project environments where Excel/LibreOffice/openpyxl are unavailable.

Modes:
- contract-only: validate package release gate sheet contract only.
- workbook mode: validate xlsx structure, sheet order, headers, row/tie-out, style hints, DLP hints.
"""
from __future__ import annotations
import argparse, json, re, sys, zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

REQUIRED_SHEETS = [
    '00_Decision','01_Action_Items','02_Final_Recon','03_Type_B_Summary',
    '04_Line_View','90_Source_Data','91_Audit_Detail','92_Evidence_Issues'
]
REQUIRED_COLUMNS = {
    '00_Decision': ['Overall Verdict', 'job_id', 'verdict'],
    '01_Action_Items': ['Action_ID', 'Severity', 'Issue', 'Status', 'action_id', 'severity'],
    '02_Final_Recon': ['Verdict', 'recon_status'],
    '03_Type_B_Summary': ['Shipment_No', 'Customs', 'DO', 'INLAND', 'THC', 'Inspection', 'Detention', 'STROAGE', 'OTHERS', 'Total_AED', 'Total_USD', 'Line_Count'],
    '04_Line_View': ['Shipment_No', 'shipment_ref', 'line_id', 'Source_Row_ID', 'Rate_Source', 'Description', 'description', 'Total_AED', 'amount', 'Total_USD', 'TYPE_B', 'type_b', 'Evidence_Status', 'evidence_status'],
    '90_Source_Data': ['Source_Row_ID', 'file_id', 'source_ref'],
    '91_Audit_Detail': ['Source_Row_ID', 'line_id', 'Shipment_No', 'shipment_ref', 'TYPE_B', 'type_b', 'Evidence_Status', 'evidence_status', 'Amount_Check', 'Risk'],
    '92_Evidence_Issues': ['Issue_ID', 'line_id', 'TYPE_B', 'type_b', 'Evidence_Status', 'evidence_status', 'Severity', 'severity', 'Action_Required'],
}
NS_MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NS_REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
NS_OFFICE_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
ERR_VALUES = {'#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NULL!', '#NUM!'}
EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
PHONE_RE = re.compile(r'\+?971[\s\-]?[0-9\s\-]{7,}|\b05[0-9][\s\-]?[0-9\s\-]{6,}\b')
SHIPMENT_RE = re.compile(r'\bHVDC-[A-Z0-9-]{5,}\b', re.I)


def col_letters(cell_ref: str) -> str:
    m = re.match(r'([A-Z]+)', cell_ref or '')
    return m.group(1) if m else ''


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def safe_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(',', '').strip()
    if s in ('', '-', '—', 'NA', 'N/A', 'None'):
        return None
    try:
        return float(s)
    except Exception:
        return None


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '').strip()).lower()


def rel_name(root: Path, p: Path) -> str:
    try:
        return str(p.relative_to(root))
    except Exception:
        return str(p)


@dataclass
class WorkbookData:
    sheet_names: list
    sheet_paths: dict
    shared_strings: list
    worksheets: dict


class XLSXReader:
    def __init__(self, path: Path):
        self.path = path
        self.z = zipfile.ZipFile(path)
        self.names = set(self.z.namelist())
        self.shared_strings = self._load_shared_strings()

    def read_xml(self, name: str):
        with self.z.open(name) as f:
            return ET.parse(f).getroot()

    def _load_shared_strings(self):
        if 'xl/sharedStrings.xml' not in self.names:
            return []
        root = self.read_xml('xl/sharedStrings.xml')
        out = []
        for si in root.findall(f'{NS_MAIN}si'):
            texts = []
            for t in si.iter(f'{NS_MAIN}t'):
                texts.append(t.text or '')
            out.append(''.join(texts))
        return out

    def workbook(self) -> WorkbookData:
        if 'xl/workbook.xml' not in self.names:
            raise ValueError('missing xl/workbook.xml')
        wb_root = self.read_xml('xl/workbook.xml')
        rels = {}
        if 'xl/_rels/workbook.xml.rels' in self.names:
            rel_root = self.read_xml('xl/_rels/workbook.xml.rels')
            for r in rel_root.findall(f'{NS_REL}Relationship'):
                rid = r.attrib.get('Id')
                target = r.attrib.get('Target', '')
                if target.startswith('/'):
                    target = target.lstrip('/')
                else:
                    target = 'xl/' + target.lstrip('./')
                rels[rid] = target
        sheet_names, sheet_paths = [], {}
        for sh in wb_root.findall(f'.//{NS_MAIN}sheet'):
            name = sh.attrib.get('name')
            rid = sh.attrib.get(f'{NS_OFFICE_REL}id')
            sheet_names.append(name)
            if rid in rels:
                sheet_paths[name] = rels[rid]
        worksheets = {}
        for name, p in sheet_paths.items():
            if p in self.names:
                worksheets[name] = self.read_xml(p)
        return WorkbookData(sheet_names=sheet_names, sheet_paths=sheet_paths, shared_strings=self.shared_strings, worksheets=worksheets)

    def cell_value(self, c):
        t = c.attrib.get('t')
        v_el = c.find(f'{NS_MAIN}v')
        f_el = c.find(f'{NS_MAIN}f')
        if f_el is not None:
            # Keep formula marker separate; cached value may still exist.
            if v_el is None:
                return '=' + (f_el.text or '')
        if t == 's':
            try:
                idx = int(v_el.text if v_el is not None and v_el.text is not None else -1)
                return self.shared_strings[idx] if 0 <= idx < len(self.shared_strings) else None
            except Exception:
                return None
        if t == 'inlineStr':
            texts = []
            is_el = c.find(f'{NS_MAIN}is')
            if is_el is not None:
                for txt in is_el.iter(f'{NS_MAIN}t'):
                    texts.append(txt.text or '')
            return ''.join(texts)
        if t == 'str':
            return v_el.text if v_el is not None else None
        if t == 'b':
            return (v_el.text == '1') if v_el is not None else None
        if t == 'e':
            return v_el.text if v_el is not None else None
        if v_el is None or v_el.text is None:
            return None
        raw = v_el.text
        try:
            f = float(raw)
            return int(f) if f.is_integer() else f
        except Exception:
            return raw

    def sheet_matrix(self, sheet_root):
        rows = []
        formula_cells = []
        error_cells = []
        for row in sheet_root.findall(f'.//{NS_MAIN}sheetData/{NS_MAIN}row'):
            row_idx = int(row.attrib.get('r', len(rows)+1))
            values = {}
            for c in row.findall(f'{NS_MAIN}c'):
                ref = c.attrib.get('r', '')
                col = col_index(col_letters(ref))
                val = self.cell_value(c)
                if c.find(f'{NS_MAIN}f') is not None:
                    formula_cells.append({'cell': ref, 'formula': c.find(f'{NS_MAIN}f').text or ''})
                if c.attrib.get('t') == 'e' or str(val) in ERR_VALUES:
                    error_cells.append({'cell': ref, 'value': val})
                values[col] = val
            rows.append((row_idx, values))
        if not rows:
            return [], formula_cells, error_cells
        max_row = max(r for r,_ in rows)
        max_col = max((max(vals.keys()) if vals else 0) for _, vals in rows)
        matrix = [[None for _ in range(max_col)] for __ in range(max_row)]
        for r, vals in rows:
            for c, val in vals.items():
                if r > 0 and c > 0:
                    matrix[r-1][c-1] = val
        return matrix, formula_cells, error_cells


def header_map(matrix):
    if not matrix:
        return {}, []
    # First non-empty row is considered header.
    for row in matrix[:10]:
        if any(v not in (None, '') for v in row):
            headers = [str(v).strip() if v is not None else '' for v in row]
            return {norm(h): i for i,h in enumerate(headers) if h}, headers
    return {}, []


def nonempty_data_rows(matrix):
    if not matrix:
        return []
    start = 0
    for i,row in enumerate(matrix[:10]):
        if any(v not in (None, '') for v in row):
            start = i + 1
            break
    return [r for r in matrix[start:] if any(v not in (None, '') for v in r)]


def get_col_idx(hmap, candidates):
    for cand in candidates:
        n = norm(cand)
        if n in hmap:
            return hmap[n]
    # fuzzy fallback
    for cand in candidates:
        n = norm(cand)
        for k, idx in hmap.items():
            if n in k or k in n:
                return idx
    return None


def sum_col(rows, idx):
    if idx is None:
        return None
    total = 0.0
    count = 0
    for r in rows:
        val = r[idx] if idx < len(r) else None
        f = safe_float(val)
        if f is not None:
            total += f
            count += 1
    return total if count else None


def find_final_subtotal(matrix):
    for row in matrix:
        for i, val in enumerate(row):
            if isinstance(val, str) and 'final subtotal' in val.lower():
                # find next numeric on the same row
                for x in row[i+1:]:
                    f = safe_float(x)
                    if f is not None:
                        return f
    return None


def validate_contract_only(root: Path):
    errors = []
    p = root/'rules/Release_Gate_v3.2_PRO.json'
    if not p.exists():
        errors.append('missing rules/Release_Gate_v3.2_PRO.json')
    else:
        data = json.loads(p.read_text(encoding='utf-8'))
        sheets = data.get('workbook_submission_sheets') or data.get('workbook_required_sheets')
        if sheets != REQUIRED_SHEETS:
            errors.append(f'release gate sheet contract mismatch: {sheets}')
        if data.get('forbidden_default_sheet') in REQUIRED_SHEETS:
            errors.append(f'release gate forbids required sheet: {data.get("forbidden_default_sheet")}')
    return {'check': 'workbook_output_validate', 'mode': 'contract_only', 'status': 'PASS' if not errors else 'FAIL', 'errors': errors, 'required_sheets': REQUIRED_SHEETS}


def validate_workbook(path: Path, require_final_subtotal=False, dlp_mode='internal', tolerance=0.01):
    errors, warnings = [], []
    metrics = {}
    try:
        xr = XLSXReader(path)
        wb = xr.workbook()
    except Exception as exc:
        return {'check':'workbook_output_validate','mode':'workbook','status':'FAIL','workbook':str(path),'errors':[f'invalid_xlsx: {exc}'],'warnings':warnings,'metrics':metrics}

    if wb.sheet_names != REQUIRED_SHEETS:
        errors.append(f'sheet_order_mismatch: {wb.sheet_names}')
    metrics['sheet_count'] = len(wb.sheet_names)
    metrics['required_sheet_count'] = len(REQUIRED_SHEETS)
    metrics['sheets'] = wb.sheet_names

    sheet_data = {}
    all_formula_cells, all_error_cells = {}, {}
    for s in REQUIRED_SHEETS:
        root = wb.worksheets.get(s)
        if root is None:
            errors.append(f'missing worksheet xml for {s}')
            continue
        matrix, formulas, error_cells = xr.sheet_matrix(root)
        sheet_data[s] = matrix
        all_formula_cells[s] = formulas
        all_error_cells[s] = error_cells

        hmap, headers = header_map(matrix)
        missing_cols = []
        for c in REQUIRED_COLUMNS.get(s, []):
            if get_col_idx(hmap, [c]) is None:
                missing_cols.append(c)
        if missing_cols:
            # Some decision/recon sheets can be key-value rather than tabular. Warn instead of hard fail for those.
            if s in {'00_Decision','02_Final_Recon'}:
                warnings.append(f'{s} missing tabular columns: {missing_cols}')
            else:
                errors.append(f'{s} missing required columns: {missing_cols}')

        # style hints
        pane = root.find(f'.//{NS_MAIN}sheetViews/{NS_MAIN}sheetView/{NS_MAIN}pane')
        if pane is None:
            warnings.append(f'{s}: freeze top row not detected')
        autofilter = root.find(f'.//{NS_MAIN}autoFilter')
        tableparts = root.find(f'.//{NS_MAIN}tableParts')
        if autofilter is None and tableparts is None:
            warnings.append(f'{s}: autofilter/table filter not detected')

        # Formula_Text safety
        formula_cols = [i+1 for i,h in enumerate(headers) if 'formula' in norm(h)]
        if formula_cols:
            for fc in formulas:
                cidx = col_index(col_letters(fc['cell']))
                if cidx in formula_cols:
                    errors.append(f'{s}: live formula detected in Formula_Text column at {fc["cell"]}')

    # formula errors
    err_flat=[]
    for s, cells in all_error_cells.items():
        for c in cells:
            err_flat.append({'sheet':s, **c})
    if err_flat:
        errors.append(f'formula/error cells detected: {err_flat[:10]}')

    # DLP scan over shared strings and inline string values in matrices
    dlp_hits=[]
    strings = list(wb.shared_strings)
    for m in sheet_data.values():
        for row in m:
            for v in row:
                if isinstance(v, str):
                    strings.append(v)
    for s in strings:
        if EMAIL_RE.search(s):
            dlp_hits.append({'type':'email','sample':'[MASKED_EMAIL]'})
        if PHONE_RE.search(s):
            dlp_hits.append({'type':'phone','sample':'[MASKED_PHONE]'})
        if SHIPMENT_RE.search(s):
            dlp_hits.append({'type':'shipment_ref','sample':'[MASKED_SHIPMENT]'})
        if len(dlp_hits) >= 20:
            break
    metrics['dlp_hits_count'] = len(dlp_hits)
    if dlp_hits:
        if dlp_mode == 'public':
            errors.append(f'public DLP hits detected: {dlp_hits[:5]}')
        else:
            warnings.append(f'internal DLP markers present; mask before public sharing: {len(dlp_hits)} hit(s)')

    # Row/recon metrics
    source_rows = nonempty_data_rows(sheet_data.get('90_Source_Data', []))
    line_rows = nonempty_data_rows(sheet_data.get('04_Line_View', []))
    typeb_rows = nonempty_data_rows(sheet_data.get('03_Type_B_Summary', []))
    metrics['source_line_count'] = len(source_rows)
    metrics['line_audit_count'] = len(line_rows)
    metrics['type_b_summary_row_count'] = len(typeb_rows)
    if source_rows and line_rows and len(source_rows) != len(line_rows):
        # SCT note: source_data from PDF text_spans (full pop per reviewer) often differs in count from line_view (charges); treat as warning not hard blocker for unified platform
        warnings.append(f'source_line_count != line_audit_count: {len(source_rows)} vs {len(line_rows)} (SCT: spans vs charges expected)')

    line_hmap, _ = header_map(sheet_data.get('04_Line_View', []))
    typeb_idx = get_col_idx(line_hmap, ['TYPE_B', 'type_b'])
    ev_idx = get_col_idx(line_hmap, ['Evidence_Status', 'evidence_status'])
    line_total_aed_idx = get_col_idx(line_hmap, ['Total_AED', 'TOTAL AMOUNT AED', 'amount', 'Amount'])
    line_total_usd_idx = get_col_idx(line_hmap, ['Total_USD', 'TOTAL AMOUNT USD', 'amount_usd'])
    typeb_classified_count = sum(1 for r in line_rows if typeb_idx is not None and typeb_idx < len(r) and str(r[typeb_idx] or '').strip())
    evidence_status_count = sum(1 for r in line_rows if ev_idx is not None and ev_idx < len(r) and str(r[ev_idx] or '').strip())
    metrics['type_b_classified_count'] = typeb_classified_count
    metrics['evidence_status_count'] = evidence_status_count
    if line_rows:
        if typeb_classified_count != len(line_rows):
            warnings.append(f'type_b_classified_count != line_audit_count: {typeb_classified_count} vs {len(line_rows)} (may be ok for SCT naming/partial)')
        if evidence_status_count != len(line_rows):
            warnings.append(f'evidence_status_count != line_audit_count: {evidence_status_count} vs {len(line_rows)} (evidence optional in some SCT flows)')

    line_total_aed = sum_col(line_rows, line_total_aed_idx)
    line_total_usd = sum_col(line_rows, line_total_usd_idx)
    metrics['line_total_aed'] = round(line_total_aed, 2) if line_total_aed is not None else None
    metrics['line_total_usd'] = round(line_total_usd, 2) if line_total_usd is not None else None

    sum_hmap, _ = header_map(sheet_data.get('03_Type_B_Summary', []))
    sum_total_aed_idx = get_col_idx(sum_hmap, ['Total_AED'])
    sum_total_usd_idx = get_col_idx(sum_hmap, ['Total_USD'])
    typeb_total_aed = sum_col(typeb_rows, sum_total_aed_idx)
    typeb_total_usd = sum_col(typeb_rows, sum_total_usd_idx)
    metrics['type_b_total_aed'] = round(typeb_total_aed, 2) if typeb_total_aed is not None else None
    metrics['type_b_total_usd'] = round(typeb_total_usd, 2) if typeb_total_usd is not None else None
    if line_total_aed is not None and typeb_total_aed is not None:
        delta = round(line_total_aed - typeb_total_aed, 2)
        metrics['delta_line_vs_typeb_aed'] = delta
        if abs(delta) > tolerance:
            errors.append(f'line vs TYPE-B AED delta exceeds tolerance: {delta}')
    if line_total_usd is not None and typeb_total_usd is not None:
        delta = round(line_total_usd - typeb_total_usd, 2)
        metrics['delta_line_vs_typeb_usd'] = delta
        if abs(delta) > tolerance:
            # USD derived via FX in 03_Type_B; lines often AED primary in SCT sample -> warning (AED tie-out is the critical gate check)
            warnings.append(f'line vs TYPE-B USD delta exceeds tolerance: {delta} (SCT: AED primary, USD derived; AED delta checked strictly)')

    final_subtotal = find_final_subtotal(sheet_data.get('02_Final_Recon', []))
    metrics['final_subtotal_detected'] = final_subtotal
    if final_subtotal is None:
        msg = 'Final Subtotal Before VAT not detected'
        if require_final_subtotal:
            errors.append(msg)
        else:
            warnings.append(msg)

    status = 'PASS'
    if errors:
        status = 'FAIL'
    elif warnings:
        status = 'AMBER'
    return {
        'check':'workbook_output_validate',
        'mode':'workbook',
        'status':status,
        'workbook':str(path),
        'required_sheets':REQUIRED_SHEETS,
        'metrics':metrics,
        'errors':errors,
        'warnings':warnings[:100],
    }


def run(root='.', workbook=None, contract_only=False, require_final_subtotal=False, dlp_mode='internal'):
    root = Path(root)
    if contract_only or workbook is None:
        # If root itself is an xlsx and contract_only is false, validate workbook.
        if isinstance(root, Path) and root.suffix.lower() == '.xlsx' and not contract_only:
            return validate_workbook(root, require_final_subtotal=require_final_subtotal, dlp_mode=dlp_mode)
        return validate_contract_only(root)
    return validate_workbook(Path(workbook), require_final_subtotal=require_final_subtotal, dlp_mode=dlp_mode)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('root_or_workbook', nargs='?', default='.')
    ap.add_argument('--workbook')
    ap.add_argument('--contract-only', action='store_true')
    ap.add_argument('--require-final-subtotal', action='store_true')
    ap.add_argument('--dlp-mode', choices=['internal','public'], default='internal')
    args = ap.parse_args()
    p = Path(args.root_or_workbook)
    if p.suffix.lower() == '.xlsx' and not args.contract_only and not args.workbook:
        r = validate_workbook(p, require_final_subtotal=args.require_final_subtotal, dlp_mode=args.dlp_mode)
    else:
        r = run(p, workbook=args.workbook, contract_only=args.contract_only, require_final_subtotal=args.require_final_subtotal, dlp_mode=args.dlp_mode)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status'] == 'PASS' else 1)
