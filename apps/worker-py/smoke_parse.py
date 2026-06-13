"""E2E smoke for the Python worker: load xlsx -> parse -> numeric integrity -> JSON."""
import json
import sys
from pathlib import Path
from app.parsers.xlsx import parse_xlsx_bytes
from app.validators.numeric_integrity import validate_numeric_integrity
from app.parsers.md import parse_md_bytes
from app.parsers.txt import parse_txt_bytes

ROOT = Path(__file__).parent / "tests"
xlsx = ROOT / "sample-invoice.xlsx"
md = ROOT / "sample-note.md"
txt = ROOT / "sample-do.txt"

# 1) xlsx
if not xlsx.exists():
    print("MISSING fixture: sample-invoice.xlsx"); sys.exit(2)
ni = parse_xlsx_bytes(xlsx.read_bytes(), file_id="fx1", file_name="sample-invoice.xlsx", parser_version="parser-0.1.0")
validate_numeric_integrity(ni.invoice_lines)
print("XLSX:", json.dumps({
    "invoice_id": ni.invoice_id,
    "currency": ni.invoice_header.currency,
    "line_count": len(ni.invoice_lines),
    "lines": [
        {
            "line_id": l.line_id[:18],
            "description": l.description,
            "qty": l.qty, "rate": l.rate, "amount": l.amount,
            "nis": l.numeric_integrity_status, "nd": l.numeric_delta
        } for l in ni.invoice_lines
    ],
    "parser_confidence": ni.parser_confidence
}, indent=2))

# 2) md (synthesize)
md_text = b"# BL-12345\nShipment HVDC-AGI-001 delivered on 2026-04-01 to MOSB."
ni2 = parse_md_bytes(md_text, file_id="fx2", file_name="note.md", parser_version="parser-0.1.0")
print("\nMD:", json.dumps({
    "line_count": len(ni2.invoice_lines),
    "evidence": [{"ref": e.matched_reference, "conf": e.confidence, "span": e.text_span[:60]} for e in ni2.evidence_candidates]
}, indent=2))

# 3) txt (synthesize)
txt_text = b"DO released for BL-AUH-002.\nContainer MSCU1234567."
ni3 = parse_txt_bytes(txt_text, file_id="fx3", file_name="do.txt", parser_version="parser-0.1.0")
print("\nTXT:", json.dumps({
    "evidence": [{"ref": e.matched_reference, "conf": e.confidence} for e in ni3.evidence_candidates]
}, indent=2))

print("\nALL E2E SMOKE OK")
