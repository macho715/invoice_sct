"""FR-020a: |qty * rate - line_amount| <= 0.01 → PASS; otherwise AMBER with numeric_delta.
Schema: NumericIntegrity = Literal['PASS', 'AMBER'] (P0-1 fix — was incorrect ZERO)."""
from __future__ import annotations
from app.schemas import InvoiceLine

TOLERANCE = 0.01

def validate_numeric_integrity(lines: list[InvoiceLine]) -> None:
    for line in lines:
        if line.qty is None or line.rate is None:
            continue
        computed = float(line.qty) * float(line.rate)
        delta = abs(computed - float(line.amount))
        line.numeric_delta = round(delta, 6)
        line.numeric_integrity_status = 'PASS' if delta <= TOLERANCE else 'AMBER'
