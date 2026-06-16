# PDF Parser Patch Report v2.1

## Verdict
PASS WITH WARNINGS

## Evidence
- Project Source Package v3.2 scan: PASS / contract source present masked.
- Script compile: `python -m py_compile pdf_hybrid_parser_pro_v2_1.py` PASS.
- Uploaded PDF validation: 16 PDFs → PASS 12 / AMBER 4 / FAIL 0 / ZERO 0.

## Changed Files
- `pdf_hybrid_parser_pro_v2_1.py`
- `20260615_pdf_parse_procedure_v2_1_PATCHED.md`
- `parser_out_v2_1_final/pdf_evidence_index.json`
- `parser_out_v2_1_final/pdf_line_items.csv`
- `parser_out_v2_1_final/summary.md`

## Main Fixes
1. Replaced single-key DOC_TYPE matching with priority fingerprint rules.
2. Added `PORT_ALLIED`, `PORT_CSP`, `CARRIER_CMA`, `AIRPORT_FEES`, `AIRPORT_APPOINTMENT` patterns.
3. Added `DELIVERY_NOTIFICATION`, `D.O.No`, `D.O. NUMBER` handling.
4. Added filename shipment range fallback.
5. Added ISO-6346 container validation.
6. Added DLP masking for BL/AWB/DO/Invoice in outputs.
7. Added line item extraction for carrier/port/airport/customs debit patterns.
8. Made render QA explicit via `--render`, not always-on.

## Remaining AMBER
- BOE_CUSTOMS: final HS/UAE Customs decision requires reviewer.
- One scanned DN has no native text layer; run OCR/manual visual QA before final audit.
