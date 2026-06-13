# DSV SHIPMENT FULL PACKAGE v3.2_PRO

Generated_UTC: `2026-06-09T09:37:13.251270+00:00`  
Patch_ID: `HARNESS-ENG-v3.2-WORKBOOK-OUTPUT-GATE-20260609`  
Mode: `INTERNAL_FULL / ONE_ZIP / WORKBOOK_OUTPUT_GATE`  
Security: `PRIVATE_INTERNAL_RATE_MASTER_INCLUDED`

## Purpose
This package is the project-upload full package for DSV Invoice Audit & Final Validator PRO. It keeps the v3.1 single-ZIP consolidation and adds the v3.2 Harness Engineering output gate so that the same audit logic produces a repeatable 8-sheet workbook artifact.

## Upload Target
Upload this ZIP as the single Project package:

`DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL.zip`

## Root Files
| File | Purpose |
|---|---|
| `01_GPT_PROJECT_INSTRUCTIONS.md` | Copy/paste Project operating instruction anchor |
| `02_COMBINED_SYSTEM_KNOWLEDGE.md` | Consolidated system knowledge and modules |
| `rules/DSV_RULEPACK_COMBINED_v3.1_PRO.json` | Combined machine-readable rulepack, patched to v3.2 release gate |
| `rules/Release_Gate_v3.2_PRO.json` | Authoritative v3.2 release/output contract |
| `private/contract_rate.json` | Private internal rate master; do not share publicly |
| `scripts/harness_validate_package.py` | Full harness runner |
| `scripts/workbook_output_validate.py` | Final workbook structural/recon/style/DLP validator |
| `VALIDATION_REPORT.json` | Final 3-run self-test summary |

## Mandatory 8-Sheet Workbook Contract
Default workbook must contain exactly these sheets, in this order:

1. `00_Decision`
2. `01_Action_Items`
3. `02_Final_Recon`
4. `03_Type_B_Summary`
5. `04_Line_View`
6. `90_Source_Data`
7. `91_Audit_Detail`
8. `92_Evidence_Issues`

## Core Operating Gates
- Source Audit
- Contract Audit
- Evidence Audit
- Final Reconciliation
- Security/DLP
- HS/UAE Compliance
- DEM/DET & Storage
- Workbook Output Contract
- Harness/RTM Release Gate

## Mandatory Reconciliation
`Final Subtotal Before VAT = Line_Audit total = TYPE-B Matrix total`

Tolerance: `±0.01`, AED/USD as applicable.

## Local Validation Commands
Run from the extracted package root:

```bash
python scripts/harness_validate_package.py .
python scripts/harness_validate_package.py . --run-id MANUAL --output tests/validation_runs/MANUAL.json
python scripts/workbook_output_validate.py /path/to/DSV_Audit_Pack.xlsx
```

To repeat package-level self-test 3 times:

```bash
python scripts/run_self_test_3x.py .
```

## DLP Rule
Do not expose raw contract rates, private rate table, TRN, BOE, BL, container no, shipment no, vendor/person/email, approval text, credentials, API keys, or internal amounts in public answers. Public outputs must mask protected values.

## Test Status
Self-test was executed 3 times after v3.2 patch. See:
- `tests/validation_runs/TEST_RUN_01.json`
- `tests/validation_runs/TEST_RUN_02.json`
- `tests/validation_runs/TEST_RUN_03.json`
- `VALIDATION_REPORT.json`

## ROUNDUP Disclosure
`결과값은 ROUNDUP(2자리)을 반영하지 않은 값입니다.`
