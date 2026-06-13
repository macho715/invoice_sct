# Patch Notes - 2026-06-07 ref_rate_usd Link Repair

## Issue

`items.ref_rate_usd` was written as a `HYPERLINK()` formula. The workbook is later opened and saved by the GPT runner to append `self_check`, `pod_reconciliation`, and `md_as_pdf_evidence` sheets. That openpyxl save path can strip formula cached values, so `ref_rate_usd` may appear blank or non-clickable in non-calculating workbook previews even though the formula text remains.

## Fix

- Price/rate cells are now written as actual internal hyperlink objects instead of `HYPERLINK()` formulas.
- `ref_rate_usd` links point to the matched `lane_map_reference!F{row}` cell.
- The final formatting step preserves visible hyperlink styling for actual hyperlink cells.
- Self-check now includes hard checks for:
  - `workbook.items.ref_rate_usd_links`
  - `workbook.items.ref_rate_usd_display_values`

## Verified Behavior

For rows with `ref_lane_id`, `ref_rate_usd` must be both visible in data-only mode and clickable as an internal workbook hyperlink.
