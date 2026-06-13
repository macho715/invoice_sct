# HVDC Domestic GPT CI Runtime Patch Notes

Patch date: 2026-06-05

## Fixes

1. Zip packaging normalized to POSIX `/` separators.
   - Prevents Linux Code Interpreter extraction from creating literal backslash filenames.
   - Ensures `runtime/gpt_ci_runner.py` is available after standard `zipfile.extractall()`.

2. `gpt_ci_runner.py` status classification patched.
   - Known ChatGPT CI host stderr block from `artifact_tool` spreadsheet warmup is retained in logs but ignored for audit status classification.
   - When audit `exit_code` is 0 and required outputs exist, this known external warmup traceback no longer forces `status: failed`.
   - Adds `stderr_review` to `gpts_run_summary.json` and `gpts_run_summary.md`.

## Revalidation

Patched runner was re-executed against `/mnt/data/domestic202601.xlsx`.

Observed result:
- `status`: `succeeded`
- `exit_code`: `0`
- `stderr_review.known_benign_only`: `true`
- `row_count`: `36`
- `verdict_counts`: `VERIFIED 32 / FAIL 4`
- `cg_band_counts`: `PASS 24 / CRITICAL 12`

## Scope

No business audit thresholds, lane data, rate ledger, invoice parsing rules, or Cost-Guard scoring rules were changed.
