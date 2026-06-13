"""xlsx parser using openpyxl. Supports header alias detection (FR-014)."""
from __future__ import annotations
import io
from openpyxl import load_workbook
from app.schemas import InvoiceLine, NormalizedInvoice, InvoiceHeader, normalize_line_id

HEADER_ALIASES: dict[str, list[str]] = {
    'description': ['description', 'desc', 'charge', 'charge description', 'item'],
    'qty':         ['qty', 'quantity', 'units', 'count'],
    'rate':        ['rate', 'unit rate', 'unit_price', 'unit price', 'price'],
    'amount':      ['amount', 'line amount', 'line_amount', 'total', 'line total'],
    'currency':    ['currency', 'ccy', 'curr'],
    'shipment_ref': ['shipment no', 'shipment_no', 'shipment ref', 'shipment_ref', 'shipment id', 'shpt', 'hvdc'],
    'job_number':   ['job no', 'job_no', 'job number', 'job_number', 'job #', 'job#'],
    'rate_basis':   ['rate basis', 'rate_basis', 'unit', 'uom', 'basis', 'per'],
    'charge_component': ['charge component', 'for_charge_component', 'type', 'type b', 'type_b', 'charge type', 'category']
}

HEADER_FIELD_LABELS: dict[str, list[str]] = {
    'invoice_no':  ['invoice no', 'invoice #', 'inv no', 'invoice number'],
    'vendor':      ['vendor', 'supplier', 'billed by', 'from', 'vendor name', 'supplier name'],
    'issue_date':  ['date', 'issue date', 'invoice date', 'date of issue'],
}

def _detect_headers(header_row: list) -> dict[str, int]:
    """Map canonical field ??column index. Returns empty dict if no canonical field found."""
    norm = [str(c or '').strip().lower() for c in header_row]
    out: dict[str, int] = {}
    for canon, aliases in HEADER_ALIASES.items():
        for i, cell in enumerate(norm):
            if cell in aliases:
                out[canon] = i
                break
    return out

def _detect_header_fields(rows: list, max_scan: int = 10) -> dict[str, str | None]:
    result: dict[str, str | None] = {'invoice_no': None, 'vendor': None, 'issue_date': None}
    found: set[str] = set()
    for r_idx in range(min(max_scan, len(rows))):
        row = rows[r_idx]
        for c_idx, cell in enumerate(row):
            if cell is None:
                continue
            text = str(cell).strip().lower().rstrip(':')
            for field, aliases in HEADER_FIELD_LABELS.items():
                if field in found:
                    continue
                if text in aliases:
                    value = None
                    if c_idx + 1 < len(row):
                        value = _cell_str(row[c_idx + 1])
                    if value is None and r_idx + 1 < len(rows):
                        below_row = rows[r_idx + 1]
                        if c_idx < len(below_row):
                            value = _cell_str(below_row[c_idx])
                    if value:
                        result[field] = value
                        found.add(field)
    return result

def _cell_num(cell) -> float | None:
    if cell is None: return None
    if isinstance(cell, (int, float)): return float(cell)
    try: return float(str(cell).replace(',', ''))
    except (ValueError, TypeError): return None

def _cell_str(cell) -> str | None:
    if cell is None: return None
    s = str(cell).strip()
    return s if s else None

def parse_xlsx_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    wb = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("empty xlsx")

    header_fields = _detect_header_fields(rows)

    header_row_idx: int | None = None
    cmap: dict[str, int] = {}
    for i in range(min(10, len(rows))):
        cmap = _detect_headers(list(rows[i]))
        if 'description' in cmap and 'amount' in cmap:
            header_row_idx = i
            break
    if header_row_idx is None:
        raise ValueError("xlsx missing required columns (description, amount)")

    lines: list[InvoiceLine] = []
    for r_idx, row in enumerate(rows[header_row_idx + 1:], start=header_row_idx + 2):
        desc = _cell_str(row[cmap['description']]) if 'description' in cmap else None
        amt  = _cell_num(row[cmap['amount']])    if 'amount'    in cmap else None
        if desc is None and amt is None:
            continue  # skip empty rows (FR-016)
        currency = (_cell_str(row[cmap['currency']]) or 'AED') if 'currency' in cmap else 'AED'
        if currency not in ('AED', 'USD'):
            currency = 'AED'
        line = InvoiceLine(
            line_id=normalize_line_id(file_id, ws.title, r_idx, cmap['description']),
            description=desc or '(missing description)',
            currency=currency,  # type: ignore[arg-type]
            amount=float(amt or 0.0),
            qty=_cell_num(row[cmap['qty']]) if 'qty' in cmap else None,
            rate=_cell_num(row[cmap['rate']]) if 'rate' in cmap else None,
            source_ref={'sheet': ws.title, 'row': r_idx, 'col': str(cmap['description'])},
            shipment_ref=_cell_str(row[cmap['shipment_ref']]) if 'shipment_ref' in cmap else None,
            job_number=_cell_str(row[cmap['job_number']]) if 'job_number' in cmap else None,
            rate_basis=_cell_str(row[cmap['rate_basis']]) if 'rate_basis' in cmap else None,
            for_charge_component=_cell_str(row[cmap['charge_component']]) if 'charge_component' in cmap else None
        )
        lines.append(line)

    if not lines:
        raise ValueError("xlsx has no usable invoice line")

    header_currency = lines[0].currency
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(
            invoice_no=header_fields.get('invoice_no'),
            vendor=header_fields.get('vendor'),
            issue_date=header_fields.get('issue_date'),
            currency=header_currency,
            invoice_total=None
        ),
        invoice_lines=lines,
        evidence_candidates=[],
        parser_confidence=0.9,
        parser_version=parser_version
    )
