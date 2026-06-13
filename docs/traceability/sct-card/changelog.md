# SCT Card Traceability Changelog

- generatedAt: 2026-06-09T16:02:42.822Z
- command: npm run report:sct-card

## Current bundle contents

- decision-log.md: scenario verdicts, intents, HumanGate state, allowed and blocked actions.
- simulation-log.md: prompt-level inputs and summarized card outputs.
- validation-report.md: evidence count, direct support ratio, reason codes, and RulePacks.
- ActionGate coverage is represented by writeBackMode and auditRecordRequired fields in simulation-log.md and validation-report.md.
- metrics-report.md: deterministic smoke metrics for router accuracy, verdict accuracy, unauthorized write-back, action audit completeness, and generic startNode leakage.
- browser-smoke-report.md: real browser smoke evidence from the Playwright MCP browser when that smoke has been run.
- pii-nda-scan-report.md: output-surface scan for raw email, UAE phone, OpenAI token-like, and JWT-like patterns when npm run scan:sct-pii has been run.
- source-corpus-pii-nda-audit.md: data/corpus raw sensitive-pattern audit and PII/NDA/person-name review marker inventory when npm run audit:source-pii has been run.
- governance-v2-completion-audit.md: prompt-to-artifact checklist for user scenarios, FR/NFR/SC/T/OQ status, evidence, and gaps.
- changelog.md: this generation record.

## Known limits

- This bundle does not replace Playwright E2E, axe a11y, Lighthouse, or manual ChatGPT iframe verification.
- This bundle does not prove the full missing-input detection KPI of 90.00%.
- The PII/NDA scan covers SCT output surfaces and traceability artifacts. It does not certify every source corpus or evidence file.
- The source-corpus audit is regex-based. It does not replace human semantic adjudication of every person-name or NDA-sensitive reference.
