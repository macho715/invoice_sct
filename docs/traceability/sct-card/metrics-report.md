# SCT Card Metrics Report

- generatedAt: 2026-06-09T16:02:42.822Z
- command: npm run report:sct-card
- coverage note: This is a deterministic smoke metric report. It does not replace the approved full-size regression set required for final KPI claims.

| Metric | Result | Target | Status |
| --- | ---: | ---: | --- |
| Router expected-intent accuracy | 100.00% | >= 95.00% | PASS_SMOKE |
| Verdict expected-output accuracy | 100.00% | >= 95.00% | PASS_SMOKE |
| ActionGate expected-mode accuracy | 100.00% | 100.00% | PASS_SMOKE |
| Meta-review graph context accuracy | 100.00% | 100.00% | PASS_SMOKE |
| Action audit completeness | 100.00% | 100.00% | PASS_SMOKE |
| Unauthorized write-back count | 0 | 0 | PASS_SMOKE |
| Generic stopword startNode leakage | 0 | 0 | PASS_SMOKE |

## Scenario coverage

| Scenario | Expected intent | Actual intent | Expected verdict | Actual verdict | ActionGate modes | Meta review |
| --- | --- | --- | --- | --- | --- | --- |
| system-diagnostic | SYSTEM_DIAGNOSTIC | SYSTEM_DIAGNOSTIC | DIAGNOSTIC | DIAGNOSTIC | READ_ONLY | true |
| email-draft | EMAIL_DRAFT | EMAIL_DRAFT | DRAFT_READY | DRAFT_READY | READ_ONLY | Not provided |
| email-send-action-gate | EMAIL_DRAFT | EMAIL_DRAFT | PENDING_APPROVAL | PENDING_APPROVAL | DRY_RUN | Not provided |
| cost-guard | COST_GUARD | COST_GUARD | WARN | WARN | DRY_RUN | false |
| system-component-graph | RULEPACK_GAP_ANALYSIS | RULEPACK_GAP_ANALYSIS | DIAGNOSTIC | DIAGNOSTIC | READ_ONLY | true |
| flow-code-boundary | LOGISTICS_DECISION | LOGISTICS_DECISION | BLOCK | BLOCK | READ_ONLY | false |
| p2-zero-gate | SCHEMA_BOUNDARY_REVIEW | SCHEMA_BOUNDARY_REVIEW | ZERO | ZERO | DRY_RUN | true |
| generic-stopword | GENERAL_ANSWER | GENERAL_ANSWER | Not provided | PASS | READ_ONLY | Not provided |
