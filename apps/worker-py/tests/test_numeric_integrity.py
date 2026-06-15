# apps/worker-py/tests/test_numeric_integrity.py
from app.schemas import InvoiceLine
from app.validators.numeric_integrity import validate_numeric_integrity

def test_passes_when_qty_rate_eq_amount():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'PASS'
    assert line.numeric_delta == 0.0

def test_passes_within_tolerance_0_01():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.005, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'PASS'

def test_amber_when_exceeds_tolerance():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=110.0, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'AMBER'
    assert line.numeric_delta == 10.0

def test_skips_when_qty_or_rate_missing():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status is None
    assert line.numeric_delta is None

def test_does_not_mutate_unrelated_lines():
    a = InvoiceLine(line_id='a', description='A', currency='AED', amount=10, qty=1, rate=10)
    b = InvoiceLine(line_id='b', description='B', currency='AED', amount=99)
    validate_numeric_integrity([a, b])
    assert a.numeric_integrity_status == 'PASS'
    assert b.numeric_integrity_status is None
