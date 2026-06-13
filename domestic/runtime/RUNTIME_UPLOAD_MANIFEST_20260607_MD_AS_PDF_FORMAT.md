# Runtime Upload Manifest - 20260607 MD-as-PDF Format Patch

Upload this runtime zip to the GPT Code Interpreter file area:

```text
hvdc_domestic_gpts_ci_runtime_20260607_md_as_pdf_format_patch.zip
```

## Entry Point

```text
runtime/gpt_ci_runner.py
```

## Key Additions

- `runtime/md_as_pdf_utils.py`
- `runtime/PATCH_NOTES_20260607_MD_AS_PDF_FORMAT.md`
- Updated `runtime/domestic_validator_v2_r.py`
- Updated `runtime/gpt_ci_runner.py`
- Updated `runtime/Data/DOMESTIC_SHEET_FORMAT.json`

## Output Contract

Generated audit workbooks must include:
- `self_check`
- `items`
- `summary_band`
- `summary_verdict`
- `lane_map_reference`
- `_format_contract`
- `pod_reconciliation` when MD POD evidence exists
- `md_as_pdf_evidence` when MD evidence exists
- hidden `_format_profile`

MD/Markdown POD files are considered PDF-equivalent text evidence and must not be reported as missing PDF evidence.
