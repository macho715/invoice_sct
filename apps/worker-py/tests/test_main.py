# apps/worker-py/tests/test_main.py
import io
from fastapi.testclient import TestClient
from openpyxl import Workbook
from app.main import create_app

def _xlsx_bytes():
    wb = Workbook(); ws = wb.active; ws.title = 'Invoice'
    ws.append(['Description','Qty','Rate','Amount','Currency'])
    ws.append(['TRUCKING', 2, 50.0, 100.0, 'AED'])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def test_health():
    app = create_app()
    c = TestClient(app)
    r = c.get('/health')
    assert r.status_code == 200
    body = r.json()
    # Backward-compat: composite /health may include 'version' and 'timestamp'
    assert body.get('status') == 'ok'
    assert 'version' in body
    assert 'timestamp' in body

def test_parse_xlsx_via_http(monkeypatch):
    # avoid real network by stubbing blob download
    from app.routes import parse as parse_route
    monkeypatch.setattr(parse_route, '_fetch_blob', lambda url: _xlsx_bytes())
    app = create_app()
    c = TestClient(app)
    r = c.post('/parse', json={
        'blob_ref': 'blob:job_1/inv.xlsx',
        'file_id': 'f1', 'job_id': 'job_1',
        'file_type': 'xlsx', 'parser_version': 'parser-0.1.0',
        'blob_url': 'http://signed.example/inv.xlsx'
    })
    assert r.status_code == 200, r.text
    body = r.json()
    import hashlib
    assert body['file_id'] == 'f1'
    assert body['source_sha256'] == hashlib.sha256(_xlsx_bytes()).hexdigest()
    assert body['normalized']['invoice_lines'][0]['description'] == 'TRUCKING'
    assert body['normalized']['invoice_lines'][0]['numeric_integrity_status'] == 'PASS'

def test_parse_unsupported_type_422():
    app = create_app()
    c = TestClient(app)
    r = c.post('/parse', json={'blob_ref':'b','file_id':'f','job_id':'j','file_type':'image','parser_version':'p','blob_url':'u'})
    assert r.status_code == 422
