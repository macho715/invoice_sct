"""Create a small .xlsx fixture for E2E smoke."""
from openpyxl import Workbook
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "tests" / "sample-invoice.xlsx"
OUT.parent.mkdir(parents=True, exist_ok=True)

wb = Workbook()
ws = wb.active
ws.title = "Invoice"
ws.append(["Description", "Qty", "Rate", "Amount", "Currency"])
ws.append(["TRUCKING", 2, 50.0, 100.0, "AED"])
ws.append(["THC",      1, 75.0,  75.0,  "AED"])
ws.append(["DETENTION", 1, 200.0, 200.0, "AED"])
ws.append(["DOC_FEES",  1, 50.0,  50.0,  "AED"])
wb.save(OUT)
print(f"WROTE {OUT} ({OUT.stat().st_size} bytes)")
