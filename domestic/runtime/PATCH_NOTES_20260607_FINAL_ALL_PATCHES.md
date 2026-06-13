# PATCH_NOTES_20260607_FINAL_ALL_PATCHES

Final combined patch for HVDC Domestic GPTS runtime.

## Included fixes
- `ref_rate_usd` and other price/rate fields are converted from `HYPERLINK()` formulas to actual internal hyperlink objects so display values are retained after `openpyxl` re-save.
- `items.ref_lane_id` is repaired/verified as an internal hyperlink to the matching `lane_map_reference` row.
- `md_as_pdf_evidence` semantic values are inserted into `items`:
  - `pdf_dn_number`
  - `pdf_issue_date`
  - `pdf_origin`
  - `pdf_destination`
  - `pdf_content_summary`
  - `pdf_extracted_fields`
- Header matching is semantic/tolerant where source names differ.
- The same MD evidence fields are also written back to `items.csv`.

## Hard checks added
- `workbook.final_patch.ref_lane_id_links`
- `workbook.final_patch.ref_lane_id_lane_map_targets`
- `workbook.final_patch.ref_rate_usd_links`
- `workbook.final_patch.price_links`
- `workbook.final_patch.md_as_pdf_evidence_columns`
- `workbook.final_patch.md_as_pdf_evidence_mapping`
