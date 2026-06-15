# apps/worker-py/tests/test_xlsx_matrix.py
"""DSV summary-matrix layout: charge-type-per-column, shipment-per-row.

The "MAY 2026" style summary sheet lays each charge component out as its own
column (MASTER DO CHARGE, CUSTOMS CLEARANCE CHARGE, ...) with one row per
shipment. The flat parser maps a single description/amount pair, which
mis-reads this layout. The matrix path decomposes each non-empty charge cell
into its own invoice line (charge-level decomposition, approved 2026-06-15).
"""
import io
from openpyxl import Workbook
from app.parsers.xlsx import parse_xlsx_bytes


def _make_matrix_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = 'MAY 2026'
    ws.append(['SAMSUNG C&T DRAFT INVOICE'])
    ws.append([])
    ws.append([
        'S/No', 'Shpt Ref', 'Job #', 'Type', 'BL #', 'Mode',
        'MASTER DO CHARGE', 'CUSTOMS CLEARANCE CHARGE', 'TRANSPORTATION CHARGE',
        'GRAND TOTAL (USD)', 'GRAND TOTAL (AED)', 'Remarks',
    ])
    ws.append(['01.', 'HVDC-ADOPT-SCT-0166', 'SAMF0017230', 'FREIGHT', 'SELA856', 'SEA',
               None, None, 7200, 7920, 29086.2, 'Ocean Freight'])
    ws.append(['02.', 'HVDC-ADOPT-HE-0561', 'BAMF0021081', 'CLEARANCE', '716-979', 'AIR',
               80, 150, None, 230, 845.0, 'See tab'])
    ws.append([None, None, None, None, None, None, None, None, None, None, None, None])
    ws.append(['TOTAL AMOUNT (USD)', None, None, None, None, None, None, None, None,
               8150, 29931.2, None])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_decomposes_dsv_matrix_into_charge_lines():
    raw = _make_matrix_xlsx()
    ni = parse_xlsx_bytes(raw, file_id='fmx', file_name='may2026.xlsx', parser_version='parser-0.1.0')
    # SCT-0166 has 1 charge (TRANSPORTATION), HE-0561 has 2 (MASTER DO, CUSTOMS) = 3 lines
    assert len(ni.invoice_lines) == 3
    by_shpt: dict[str, list] = {}
    for l in ni.invoice_lines:
        by_shpt.setdefault(l.shipment_ref, []).append(l)
    assert set(by_shpt) == {'HVDC-ADOPT-SCT-0166', 'HVDC-ADOPT-HE-0561'}
    # charge cells become the amount; description carries the charge name
    sct = by_shpt['HVDC-ADOPT-SCT-0166'][0]
    assert sct.amount == 7200
    assert 'TRANSPORTATION' in sct.description.upper()
    assert sct.currency == 'USD'
    assert sct.job_number == 'SAMF0017230'
    he_amounts = sorted(l.amount for l in by_shpt['HVDC-ADOPT-HE-0561'])
    assert he_amounts == [80, 150]


def test_matrix_skips_zero_and_empty_charge_cells():
    raw = _make_matrix_xlsx()
    ni = parse_xlsx_bytes(raw, file_id='fmx', file_name='may2026.xlsx', parser_version='parser-0.1.0')
    # No line should have amount 0 or come from an empty cell
    assert all(l.amount and l.amount != 0 for l in ni.invoice_lines)
    # The TOTAL row must not become a line
    assert all(l.shipment_ref for l in ni.invoice_lines)


def test_matrix_captures_invoice_total_usd():
    raw = _make_matrix_xlsx()
    ni = parse_xlsx_bytes(raw, file_id='fmx', file_name='may2026.xlsx', parser_version='parser-0.1.0')
    assert ni.invoice_header.currency == 'USD'
    assert ni.invoice_header.invoice_total == 8150
