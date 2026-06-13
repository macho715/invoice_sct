# PATCH NOTES - 2026-06-07 - REF_LANE_ID LINK REPAIR

## Scope
- Ensure every nonblank `items.ref_lane_id` is a clickable internal link to the matching `lane_map_reference` row.
- Preserve prior `ref_rate_usd` / price-rate link repair.

## Runtime Fix
- `runtime/patch/run_domestic_audit_v2.py` already writes `ref_lane_id` through `xlsxwriter.write_url(..., internal:'lane_map_reference'!A<n>)`.
- Added hard self-checks in `runtime/gpt_ci_runner.py`:
  - `workbook.items.ref_lane_id_links`
  - `workbook.items.ref_lane_id_lane_map_targets`

## Workbook Repair
- Repaired generated workbook so `items!ref_lane_id` has actual internal hyperlink objects.
- Expected target:
  - `items!Y<n>` -> `lane_map_reference!A<matched Lane_ID row>`
- Verification target count: every row with a `ref_lane_id` must resolve to `lane_map_reference`.

## Compatibility
- No column order changes.
- Type B / fixed format remains unchanged.
- MD POD remains PDF-equivalent evidence (`MD_AS_PDF_TEXT`).
