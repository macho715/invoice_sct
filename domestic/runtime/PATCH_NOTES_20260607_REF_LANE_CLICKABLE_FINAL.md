# PATCH NOTES 20260607 - REF_LANE_ID CLICKABLE FINAL

Scope:
- Repaired `items.ref_lane_id` so each value is both a visible `HYPERLINK()` formula and an internal worksheet hyperlink.
- Target format: `#'lane_map_reference'!A{row}` with friendly display text equal to the lane ID.
- Added an OOXML finalizer that runs after the final openpyxl save, preventing later workbook formatting/self_check saves from stripping cached hyperlink display behavior.
- The finalizer updates `self_check` details without inserting formula-error tokens.

Validation:
- `items.ref_lane_id` has 28/28 clickable formula links.
- `items.ref_lane_id` has 28/28 internal hyperlink objects.
- `ref_lane_id -> lane_map_reference` targets are 28/28.
- Existing ref_rate_usd, price/rate links, and MD-as-PDF evidence item fields are preserved.
