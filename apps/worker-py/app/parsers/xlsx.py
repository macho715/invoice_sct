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
    'currency':    ['currency', 'ccy', 'curr']
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
    header = rows[0]
    cmap = _detect_headers(list(header))
    if 'description' not in cmap or 'amount' not in cmap:
        raise ValueError("xlsx missing required columns (description, amount)")

    lines: list[InvoiceLine] = []
    for r_idx, row in enumerate(rows[1:], start=2):
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
            source_ref={'sheet': ws.title, 'row': r_idx, 'col': str(cmap['description'])}
        )
        lines.append(line)

    if not lines:
        raise ValueError("xlsx has no usable invoice line")

    header_currency = lines[0].currency
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency=header_currency, invoice_total=None),
        invoice_lines=lines,
        evidence_candidates=[],
        parser_confidence=0.9,
        parser_version=parser_version
    )
