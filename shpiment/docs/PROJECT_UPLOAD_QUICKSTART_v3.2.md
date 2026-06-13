# Project Upload Quickstart v3.2_PRO

## Upload
Upload the single ZIP file `DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL.zip` to the Project.

## Behavior Anchor
Use `01_GPT_PROJECT_INSTRUCTIONS.md` as the main project instruction anchor. Use `02_COMBINED_SYSTEM_KNOWLEDGE.md` as searchable knowledge.

## Validation After Extraction
```bash
python scripts/run_self_test_3x.py .
```

## Output Contract
The generated audit workbook must contain exactly 8 sheets in fixed order, including mandatory `03_Type_B_Summary`.

## Security
The package includes `private/contract_rate.json`. Treat the ZIP as internal only.
