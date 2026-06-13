# SCT Card PII/NDA Output Surface Scan

- generatedAt: 2026-06-09T16:02:47.413Z
- command: npm run scan:sct-pii
- status: PASS
- scannedFiles: 14
- findingCount: 0

## Scope

This scanner checks SCT card user-facing output surfaces and generated traceability artifacts.
It intentionally excludes source corpus content and binary artifacts because source evidence can contain raw operational material that must be handled by retrieval-time masking rather than repository-wide deletion.

Scanned targets:

- docs/QA_REPORT.md
- docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md
- docs/traceability/sct-card
- public/hvdc-answer-widget.html
- server/src/generated/widget-html.ts
- tests/fixtures/widget-browser-smoke.html

## Detectors

- raw email address
- UAE phone number
- OpenAI token-like secret
- JWT-like token

## Findings

| Detector | Location | Label | Preview |
| --- | --- | --- | --- |
| None | None | None | None |

## Result

No raw email address, UAE phone number, OpenAI token-like secret, or JWT-like token was found in the scanned SCT output surfaces.

## Limitations

This is an output-surface scan.
It does not claim that every source corpus or evidence file in the repository is free of PII/NDA material.
