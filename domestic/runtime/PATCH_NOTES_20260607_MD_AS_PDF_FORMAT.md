# HVDC Domestic GPTS Runtime Patch - MD-as-PDF + Fixed Excel Format

Patch ID: `20260607_md_as_pdf_format`
Generated: `2026-06-07T12:33:23`

## Session Review Findings

1. MD POD files were staged, but row-level evidence columns could remain blank when the MD text did not contain an exact invoice `shipment_ref`.
2. The previous MD reconciliation used a simple filename prefix parser. It could misread the leading section number such as `02. Domestic...` as invoice S/N 2.
3. Excel workbook output had a fixed `items` schema but appended sheets (`self_check`, `pod_reconciliation`) were not guaranteed to share the same visual format.
4. Re-running inside `/mnt/data` could accidentally pick up previously staged supporting docs unless `supporting_docs_staging` folders were explicitly skipped.

## Patched Behavior

- `.md` / `.markdown` files are treated as PDF-equivalent text evidence using `MD_AS_PDF_TEXT`.
- New `runtime/md_as_pdf_utils.py` centralizes:
  - HVDC reference extraction
  - row number parsing from filenames such as `_12 & 13. HVDC-..._POD.md`
  - waybill/trip/approval extraction
  - MD-as-PDF evidence inventory creation
- `domestic_validator_v2_r.py` now maps supporting evidence by:
  - exact / partial `shipment_ref`
  - row number fallback key `__ROW_SN__:<S/N>`
- `items` evidence columns are populated for MD-as-PDF evidence:
  - `supporting_docs_list`
  - `evidence_count`
  - `evidence_types`
  - `has_dn`
  - `pdf_dn_number`
  - `pdf_issue_date`
  - `pdf_origin`
  - `pdf_destination`
  - `pdf_content_summary`
  - `pdf_extracted_fields`
- `gpt_ci_runner.py` now writes:
  - `md_as_pdf_evidence_inventory.csv`
  - `md_as_pdf_evidence_inventory.md`
  - workbook sheet `md_as_pdf_evidence`
  - hidden workbook sheet `_format_profile`
- The workbook-wide style is reapplied after appending self-check sheets:
  - Calibri 10
  - horizontal center / vertical middle
  - no wrap text
  - bounded autofit-style column widths
  - `#,##0.00`, `0.00%`, `yyyy-mm-dd` number/date formats
- Supporting-doc staging skips `supporting_docs_staging` and current output/input staging folders to avoid duplicate evidence.

## Verification Result

Validated on session sample:

- `status`: `succeeded`
- `self_check.hard_pass`: `true`
- `hard_failure_count`: `0`
- `workbook_self_check_sheet_added`: `true`
- `workbook_pod_reconciliation_sheet_added`: `true`
- `workbook_md_as_pdf_evidence_sheet_added`: `true`
- `md_as_pdf_evidence_inventory.csv`: generated
- Formula error scan: no `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`

## Expected Remaining Warnings

Warnings can still appear when:
- invoice rows have no corresponding MD/PDF evidence
- row-number fallback evidence does not exactly match `shipment_ref`
- POD waybill count does not equal invoice `# Trips`

These are business-data warnings, not runtime hard failures.
