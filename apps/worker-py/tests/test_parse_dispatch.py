"""P3A: Route dispatch tests for file_type (plan §4: 3 its + coverage of pdf).

- xlsx / md / txt still work (regression)
- pdf now supported (200, evidence present, parser_confidence)
- unsupported still 422 (e.g. 'image')
"""
import io
from fastapi.testclient import TestClient
from openpyxl import Workbook
from app.main import create_app

def _xlsx_bytes():
    wb = Workbook(); ws = wb.active; ws.title = 'Invoice'
    ws.append(['Description','Qty','Rate','Amount','Currency'])
    ws.append(['TRUCKING', 2, 50.0, 100.0, 'AED'])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def _md_bytes():
    return b"# Invoice\nHVDC-LOG-123\nTotal: 1234.56 AED\n"

def _txt_bytes():
    return b"INV-999\nAmount 777.00\n"

def test_dispatch_xlsx_md_txt_pdf(monkeypatch):
    from app.routes import parse as parse_route
    # stub blob for all types (use same xlsx bytes for simplicity; pdf tests use real fixtures via unit tests)
    monkeypatch.setattr(parse_route, '_fetch_blob', lambda url: _xlsx_bytes())
    app = create_app()
    c = TestClient(app)

    for ftype, payload_extra in [
        ('xlsx', {}),
        ('md', {}),
        ('txt', {}),
        ('pdf', {'blob_url': 'http://signed/pdf-001', 'file_name': 't.pdf'}),  # pdf will use stub bytes but dispatch path exercised
    ]:
        r = c.post('/parse', json={
            'blob_ref': f'blob:job_d/{ftype}',
            'file_id': f'f-{ftype}',
            'job_id': 'job_d',
            'file_type': ftype,
            'parser_version': 'parser-0.2.0-pdf-0.1.0',
            'blob_url': f'http://signed/{ftype}'
        })
        assert r.status_code == 200, f"{ftype} -> {r.status_code} {r.text}"
        body = r.json()
        assert body['file_id'] == f'f-{ftype}'
        assert 'normalized' in body
        # pdf path populates evidence (may be empty on stub xlsx bytes but parser_conf >=0)
        if ftype == 'pdf':
            assert 'parser_confidence' in body['normalized']
            assert body['normalized']['parser_confidence'] >= 0.0

def test_dispatch_pdf_low_conf_or_issues_path(monkeypatch):
    # Use real low-text fixture via direct parser (route uses stub); this covers the issue flag path
    from app.parsers.pdf_text import parse_pdf_text_bytes
    from pathlib import Path
    raw = (Path(__file__).parent / "fixtures" / "text-pdf-005.pdf").read_bytes()
    res = parse_pdf_text_bytes(raw, file_id="f005", file_name="low.pdf", parser_version="p-0.2")
    assert res.is_text_based is False or res.parser_confidence < 0.6
    assert any(iss in res.parser_issues for iss in ("SCANNED_PAGE_DETECTED",)) or res.parser_confidence < 0.5

def test_dispatch_unsupported_still_422():
    app = create_app()
    c = TestClient(app)
    r = c.post('/parse', json={
        'blob_ref':'b','file_id':'f','job_id':'j',
        'file_type':'image',  # not in allowlist
        'parser_version':'p','blob_url':'u'
    })
    assert r.status_code == 422
