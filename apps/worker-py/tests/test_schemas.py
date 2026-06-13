# apps/worker-py/tests/test_schemas.py
from app.schemas import InvoiceLine, NormalizedInvoice, ParseResponse, normalize_line_id

def test_invoice_line_requires_description_currency_amount():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0)
    assert line.line_id == 'l1'

def test_invoice_line_rejects_unknown_currency():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        InvoiceLine(line_id='l1', description='X', currency='EUR', amount=1.0)

def test_normalize_line_id_deterministic():
    assert normalize_line_id('a.xlsx', 'Sheet1', 3, 5) == normalize_line_id('a.xlsx', 'Sheet1', 3, 5)
    assert normalize_line_id('a.xlsx', 'Sheet1', 3, 5) != normalize_line_id('a.xlsx', 'Sheet1', 4, 5)

def test_parse_response_serializes_to_json():
    ni = NormalizedInvoice(
        invoice_id='inv1',
        invoice_header={'invoice_no': None, 'vendor': None, 'issue_date': None, 'currency': 'AED', 'invoice_total': None},
        invoice_lines=[],
        evidence_candidates=[],
        parser_confidence=0.9,
        parser_version='parser-0.1.0'
    )
    pr = ParseResponse(parse_result_id='pr1', job_id='j1', file_id='f1', normalized=ni)
    j = pr.model_dump_json()
    assert '"parser_version":"parser-0.1.0"' in j
