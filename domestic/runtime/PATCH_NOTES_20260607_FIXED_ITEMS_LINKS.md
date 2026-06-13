# Patch Notes - 2026-06-07 Fixed Audit Items Format and Price Links

## Purpose

This patch locks the GPTS final Excel `items` sheet to the user-supplied `DOMESTIC_SHEET_FORMAT.json` contract and protects the price/rate hyperlink workflow.

## Fixed Output Contract

The final workbook must include:

- `items`
- `summary_band`
- `summary_verdict`
- `lane_map_reference`

The `items` sheet must use the exact 58-column order from `DOMESTIC_SHEET_FORMAT.json`.

## Price / Rate Click Links

For each `items` row with a matched `ref_lane_id`, price/rate cells are written as internal hyperlink formulas pointing to the matched reference rate source.

Approved lane rows link to:

```text
lane_map_reference!F{row}
```

Executed-rate reference rows link to:

```text
executed_lane_reference!C{row}
```

The following price/rate columns are protected:

- `Rate (AED)`
- `rate_usd`
- `Amount (US$)`
- `Total (US$)`
- `rate_usd_input`
- `rate_aed_input`
- `ref_rate_usd`
- `executed_ref_rate_usd`

`ref_lane_id` links to the matched Lane_ID cell.

## Formatting

All GPTS Excel outputs use:

- Calibri 10
- Horizontal center / vertical middle alignment
- Amount/rate number format `#,##0.00`
- Date format `yyyy-mm-dd`
- Autofilter on header row
- Freeze top row
- Bounded autofit-style widths
- Wrap text off

## Self Check

The runner now hard-fails if:

- `items` sheet is missing
- `items` header order differs from the fixed 58-column contract
- `lane_map_reference` is missing
- rows with `ref_lane_id` have no clickable price/rate links

## Files Changed

- `runtime/patch/run_domestic_audit_v2.py`
- `runtime/gpt_ci_runner.py`
- `runtime/Data/DOMESTIC_SHEET_FORMAT.json`
