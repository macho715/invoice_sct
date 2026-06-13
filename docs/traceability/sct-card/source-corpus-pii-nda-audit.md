# Source Corpus PII/NDA Audit

- generatedAt: 2026-06-09T16:02:47.612Z
- command: npm run audit:source-pii
- scope: data/corpus/*.md
- status: PASS_NO_RAW_PATTERN
- scannedFiles: 13
- rawFindingCount: 0
- reviewMarkerCount: 311

## Scope

This audit checks the source corpus that is indexed into the worker assets from `data/corpus/*.md`.
It reports raw sensitive patterns as blocking findings and policy/person markers as review inventory.
It does not print raw matched values.

## Raw Sensitive Pattern Findings

| File | Detector | Count | First line |
| --- | --- | ---: | ---: |
| None | None | 0 | None |

## Review Marker Inventory

These markers indicate where source evidence discusses PII, NDA, or person-name handling.
They are not treated as leakage by themselves.

| File | Marker | Count | First line |
| --- | --- | ---: | ---: |
| data/corpus/CONSOLIDATED-00-master-ontology.md | PII_POLICY_MARKER | 16 | 90 |
| data/corpus/CONSOLIDATED-01-core-framework-infra.md | PII_POLICY_MARKER | 6 | 379 |
| data/corpus/CONSOLIDATED-02-warehouse-flow.md | NDA_POLICY_MARKER | 1 | 191 |
| data/corpus/CONSOLIDATED-02-warehouse-flow.md | PII_POLICY_MARKER | 2 | 494 |
| data/corpus/CONSOLIDATED-03-document-ocr.md | PII_POLICY_MARKER | 6 | 113 |
| data/corpus/CONSOLIDATED-04-barge-bulk-cargo.md | NDA_POLICY_MARKER | 2 | 446 |
| data/corpus/CONSOLIDATED-04-barge-bulk-cargo.md | PII_POLICY_MARKER | 3 | 705 |
| data/corpus/CONSOLIDATED-05-invoice-cost.md | PII_POLICY_MARKER | 6 | 133 |
| data/corpus/CONSOLIDATED-06-material-chain.md | NDA_POLICY_MARKER | 1 | 600 |
| data/corpus/CONSOLIDATED-06-material-chain.md | PERSON_NAME_MARKER | 1 | 602 |
| data/corpus/CONSOLIDATED-06-material-chain.md | PII_POLICY_MARKER | 8 | 161 |
| data/corpus/CONSOLIDATED-07-port-operations.md | NDA_POLICY_MARKER | 3 | 578 |
| data/corpus/CONSOLIDATED-07-port-operations.md | PII_POLICY_MARKER | 15 | 118 |
| data/corpus/CONSOLIDATED-08-communication.md | NDA_POLICY_MARKER | 3 | 53 |
| data/corpus/CONSOLIDATED-08-communication.md | PII_POLICY_MARKER | 107 | 6 |
| data/corpus/CONSOLIDATED-09-operations.md | NDA_POLICY_MARKER | 1 | 441 |
| data/corpus/CONSOLIDATED-09-operations.md | PII_POLICY_MARKER | 8 | 428 |
| data/corpus/CONSOLIDATED-10-card-governance.md | NDA_POLICY_MARKER | 2 | 90 |
| data/corpus/CONSOLIDATED-10-card-governance.md | PII_POLICY_MARKER | 6 | 34 |
| data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md | PERSON_NAME_MARKER | 27 | 322 |
| data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md | PII_POLICY_MARKER | 79 | 6 |
| data/corpus/Team_역할분담_매트릭스.md | PERSON_NAME_MARKER | 2 | 205 |
| data/corpus/Team_역할분담_매트릭스.md | PII_POLICY_MARKER | 6 | 7 |
## Result

No raw email address, UAE phone number, OpenAI token-like secret, or JWT-like token was detected in data/corpus/*.md.

## Limitations

This audit is regex-based.
It does not prove that every personal name is unnecessary or that every NDA-sensitive concept has been semantically classified.
