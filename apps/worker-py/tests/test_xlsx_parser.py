# apps/worker-py/tests/test_xlsx_parser.py
import io
from openpyxl import Workbook
from app.parsers.xlsx import parse_xlsx_bytes

def _make_xlsx(headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Invoice'
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

def test_parses_basic_invoice_lines():
    raw = _make_xlsx(
        ['Description', 'Qty', 'Rate', 'Amount', 'Currency'],
        [
            ['TRUCKING', 2, 50.0, 100.0, 'AED'],
            ['THC',      1, 75.0,  75.0, 'AED'],
        ]
    )
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert len(ni.invoice_lines) == 2
    l0 = ni.invoice_lines[0]
    assert l0.description == 'TRUCKING' and l0.qty == 2 and l0.rate == 50.0 and l0.amount == 100.0
    assert l0.currency == 'AED'
    assert ni.invoice_header.currency == 'AED'
    assert ni.parser_version == 'parser-0.1.0'

def test_supports_header_aliases_case_insensitive():
    raw = _make_xlsx(
        ['desc', 'quantity', 'unit rate', 'line amount', 'CCY'],
        [['THC', 1, 75.0, 75.0, 'USD']]
    )
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert ni.invoice_lines[0].currency == 'USD'
    assert ni.invoice_lines[0].rate == 75.0
    assert ni.invoice_lines[0].amount == 75.0

def test_skips_empty_rows_and_uses_normalized_line_id():
    raw = _make_xlsx(['Description','Qty','Rate','Amount','Currency'], [[None,None,None,None,None], ['TRUCKING', 1, 10, 10, 'AED']])
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert len(ni.invoice_lines) == 1
    assert ni.invoice_lines[0].line_id.startswith('line_')

def test_raises_when_no_usable_line():
    import pytest
    raw = _make_xlsx(['Description','Qty','Rate','Amount','Currency'], [[None,None,None,None,None]])
    with pytest.raises(ValueError):
        parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
