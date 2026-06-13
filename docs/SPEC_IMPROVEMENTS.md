# Feature Specification: HVDC Ontology App Operational Improvements

Feature ID/Branch: 002-hvdc-ontology-operational-improvements
Created: 2026-05-10
Status: Draft
Owner: HVDC Logistics / App Platform Team
Input: `docs/operations/plan.md` Phase 1 Business Review
Last Updated: 2026-05-13
Version: v0.1.2

## Summary

### Problem

The HVDC Ontology ChatiPT App is published to GitHub and deployed as a Cloudflare Workers MCP endpoint. The remaining operational problem is to manage ontology document changes, ChatiPT Apps SDK submission quality, evidence UI, evaluation coverage, security monitoring, and work tracking as one repeatable operating process.

### ioals

- i1: Detect whether `ontology/`, `data/corpus/`, or app contract changes break corpus indexing or app verification before merge.
- i2: Keep MCP tool descriptors aligned with ChatiPT Apps SDK expectations, including `outputSchema`, `_meta`, and tool annotations.
- i3: Improve the Evidence Drawer so users can inspect source document, section, hash, freshness, validation status, and redaction state from the ChatiPT UI.
- i4: Build a repeatable golden evaluation set for high-risk prompts such as AGI M130 closure, Flow Code misuse, stale-source compliance, and NO_EVIDENCE behavior.
- i5: Add repository security monitoring for secrets, dependencies, and code scanning where supported by the GitHub plan and repository settings.
- i6: Define lightweight tracking fields for ontology change work, verification status, and release readiness without requiring GitHub Projects automation in Option B.
- i7: Keep ChatiPT card rendering decoupled from grounded data answers: `ask_hvdc_ontology` stays data-only, and `render_hvdc_answer_card` owns the `ui://hvdc/answer-card-v7.html` template.

### Non-ioals

- Ni1: Do not change ontology semantics without a separate domain approval.
- Ni2: Do not introduce automatic write-back to ERP, WMS, ATLP, Foundry, WhatsApp, email, or other production systems.
- Ni3: Do not deploy automatically to production until deployment secrets, rollback, and human approval gates are explicitly approved.
- Ni4: Do not remove existing corpus-grounding safeguards to improve UX speed.
- Ni5: Do not treat GitHub Projects or security alerts as runtime answer evidence.
- Ni6: Do not implement GitHub Projects board automation, Cloudflare auto-deploy, or release/approval workflow automation in Option B.

## User Scenarios & Testing

### User Story 1 - Ontology Change Verification (Priority: P1)

When a document or corpus file changes, the repository should rebuild the corpus index and run app verification automatically.

Why this priority: The main operational risk is changing `ontology/` without updating or validating the app-facing corpus/index.

Independent Test: Push or open a pull request that changes `ontology/` or `data/corpus/`; confirm the GitHub Actions workflow runs `npm run index` and `npm run verify`.

Acceptance Scenarios:

1. Given a pull request changes `ontology/CONSOLIDATED-00-master-ontology.md`, When GitHub Actions runs, Then the corpus index is rebuilt and app tests execute.
2. Given generated JSON is invalid, When the validation step runs, Then the workflow fails before merge.
3. Given app tests fail, When the workflow completes, Then the PR is marked as failed and the failure is visible in GitHub.

### User Story 2 - Apps SDK Contract Readiness (Priority: P1)

The app should expose MCP tools with stable schemas and metadata that match ChatiPT Apps SDK expectations.

Why this priority: Tool descriptor mismatches can create ChatiPT app registration warnings or incorrect tool behavior.

Independent Test: Run descriptor tests that compare `server/src/index.ts` tool descriptors with `chatgpt-app-submission.json`.

Acceptance Scenarios:

1. Given a tool returns `structuredContent`, When descriptors are validated, Then the tool has a matching `outputSchema`.
2. Given a tool has side effects such as audit logging, When annotations are validated, Then it is not marked as read-only.
3. Given submission metadata is generated, When JSON validation runs, Then all published tools are represented exactly once.

### User Story 3 - Evidence Drawer Inspection (Priority: P1)

Users should be able to inspect why an answer was given from the ChatiPT UI.

Why this priority: The app is only useful for operations if users can verify the source and freshness behind a claim.

Independent Test: Ask three representative questions and confirm each answer displays evidence details with document ID, section, hash, freshness, validation status, and masked PII.

Acceptance Scenarios:

1. Given an answer has evidence snippets, When the user opens the Evidence Drawer, Then each snippet shows source document, section path, document hash, and confidence.
2. Given source freshness is stale or unclear, When evidence is rendered, Then the UI shows a stale-source or review-required state.
3. Given evidence contains email or phone-like text, When the drawer renders, Then the value is masked.

### User Story 4 - Golden Evaluation Set (Priority: P2)

The repository should contain a repeatable evaluation set for known high-risk HVDC prompts.

Why this priority: Manual spot checks do not protect against regressions in grounding, blocking, and validation behavior.

Independent Test: Run the eval command locally and in CI; confirm all required expected outcomes pass.

Acceptance Scenarios:

1. Given the prompt "AGI M130 닫아도 돼?", When the eval runs and site date exists, Then M130 is accepted as delivered and missing M115/M116/M117 evidence results in `AMBER/WARN` backfill required.
2. Given the prompt "Flow Code 어디에 써?", When the eval runs, Then the answer explains WHP-only use and blocks route classification misuse.
3. Given a question has no supporting corpus evidence, When the eval runs, Then the answer returns `NO_EVIDENCE` or `BLOCK`.

### User Story 5 - Repository Security Monitoring (Priority: P2)

The GitHub repository should surface security issues for committed secrets, vulnerable dependencies, and code findings where the repository plan supports them.

Why this priority: The project uses deployment tokens, npm dependencies, public ontology documents, and GitHub Actions.

Independent Test: Confirm GitHub security settings are enabled or documented as unavailable, then verify alerts are visible from the repository Security tab or GitHub CLI/API where available.

Acceptance Scenarios:

1. Given a supported secret pattern is committed in a test branch, When GitHub scanning runs, Then the repository surfaces a secret alert.
2. Given a dependency vulnerability exists, When Dependabot alerts run, Then the repository surfaces the vulnerable package and patched version where available.
3. Given code scanning is configured, When the workflow runs, Then findings are uploaded or the run explains why scanning is unavailable.

### User Story 6 - Ontology Work Tracking (Priority: P3)

Ontology updates should be tracked with status, owner, verification result, and release readiness.

Why this priority: The team needs to know whether a document change is only edited locally, verified in CI, deployed to Cloudflare Workers, or ready for ChatiPT app submission.

Independent Test: Create a sample ontology update issue, PR checklist item, or markdown status row and confirm it records source document, reviewer, verification link, and release status.

Acceptance Scenarios:

1. Given an ontology change is proposed, When a tracking item is created, Then it includes source file, reason, owner, and expected verification.
2. Given CI passes, When the item is updated, Then the Actions run link is recorded.
3. Given deployment is not approved, When the item is reviewed, Then release status remains blocked or pending.

### User Story 7 - Decoupled Answer Card Rendering (Priority: P1)

The app should render the answer card through `render_hvdc_answer_card`, not through the initial data answer tool.

Why this priority: ChatiPT template fetch failures previously made users think the business answer failed even when the JSON result was valid.

Independent Test: Run the MCP smoke test and confirm `ask_hvdc_ontology` has no output template while `render_hvdc_answer_card` returns `ui://hvdc/answer-card-v7.html`.

Acceptance Scenarios:

1. Given `ask_hvdc_ontology` returns a grounded answer, When the tool result is inspected, Then it contains no `openai/outputTemplate`, no `_meta.ui.resourceUri`, and no `structuredContent.ui`.
2. Given the same answer is passed to `render_hvdc_answer_card`, When the tool result is inspected, Then it exposes `openai/outputTemplate` and `_meta.ui.resourceUri` as `ui://hvdc/answer-card-v7.html`.
3. Given a Daily KPI Dashboard answer contains long route, validation, action, or protected-field text, When the card renders, Then the text wraps inside the card columns instead of overflowing.

### Edge Cases

- EC1: GitHub Actions passes but Cloudflare Workers still serves an old deployment -> show deployment status as separate from CI status.
- EC2: GitHub security features are unavailable for the repository plan -> document the unavailable feature and fallback check.
- EC3: Evaluation prompts pass locally but fail on Cloudflare Workers -> keep local, CI, and live MCP validation as separate evidence.
- EC4: Evidence UI cannot render in ChatiPT -> provide text fallback with evidence IDs and validation status.
- EC5: `data/index/` is generated from a different corpus version -> fail validation if inventory/hash mismatch is detected.

## Requirements

### Functional Requirements

- FR-001: The repository MUST run corpus indexing before app verification for ontology or corpus changes.
- FR-002: The CI workflow MUST validate `data/index/corpus_index.json`, `data/index/source_role_map.json`, and `chatgpt-app-submission.json` as JSON.
- FR-003: The CI workflow MUST run `npm run verify` after indexing and JSON validation.
- FR-004: MCP tool descriptors MUST include stable `inputSchema`, `outputSchema` where structured output is returned, `_meta`, and appropriate tool annotations.
- FR-005: The submission artifact MUST list the same public MCP tools as the server implementation.
- FR-006: The Evidence Drawer MUST display evidence source document, section path, document hash, confidence, and validation status when available.
- FR-007: The Evidence Drawer MUST mask phone numbers and email addresses before display.
- FR-008: The evaluation suite MUST include golden prompts for AGI M130 closure, Flow Code WHP-only use, NO_EVIDENCE behavior, stale-source compliance, and invoice/cost human-gate behavior.
- FR-009: The security setup MUST document whether Secret Scanning, Dependabot alerts, and Code Scanning are enabled, unavailable, or pending.
- FR-010: Ontology work tracking MUST capture source file, reason for change, owner, verification link, and release status, but Option B MUST NOT require GitHub Projects automation.
- FR-011: Cloudflare Workers production deployment MUST remain separate from CI verification until an explicit deployment approval gate is defined.
- FR-012: The repository MUST keep public disclosure status visible for files under `ontology/`, `data/corpus/`, docs, and `.docx` artifacts.
- FR-013: `data/index/` MUST stay committed as reviewable generated artifacts for Option B; `corpus_index.json` and `corpus_inventory.csv` MUST be regenerated from `data/corpus/`, while explicitly documented mapping files such as `source_role_map.json` MAY remain manually maintained.

### Non-Functional Requirements

- NFR-001 (Reliability): CI verification MUST fail closed when corpus indexing, JSON validation, typecheck, or tests fail.
- NFR-002 (Traceability): Every golden eval result MUST be traceable to prompt, expected verdict, required evidence condition, and actual result.
- NFR-003 (Security): Secrets and deployment tokens MUST NOT be committed to the repository.
- NFR-004 (Privacy): UI, logs, eval output, and report artifacts MUST mask phone numbers and email addresses.
- NFR-005 (Maintainability): App contract checks SHOULD be deterministic and runnable locally without network access.
- NFR-006 (Usability): Evidence Drawer fallback text MUST be readable in ChatiPT even if the iframe component fails.

## Assumptions & Dependencies

### Assumptions

- A1: The selected implementation scope is Option B from `docs/operations/plan.md`: balanced improvement with CI/security hardening, SDK contract readiness, Evidence Drawer improvement, and golden evals.
- A2: `macho715/SCT_ONTOLOiY` remains the GitHub repository for this work.
- A3: `npm run index` and `npm run verify` remain the canonical local verification commands.
- A4: The current public disclosure decision allows full repository contents to remain public unless the user later changes scope.

### Dependencies

- D1: GitHub Actions for CI execution.
- D2: GitHub repository security settings for Secret Scanning, Dependabot alerts, and Code Scanning.
- D3: OpenAI Apps SDK and MCP server descriptor behavior.
- D4: Cloudflare Workers deployment state for live MCP validation.
- D5: HVDC ontology corpus files under `ontology/` and `data/corpus/`.

## Success Criteria

- SC-001: A pull request that changes `ontology/` triggers CI and records `npm run index` plus `npm run verify` results.
- SC-002: CI fails when `chatgpt-app-submission.json` is malformed.
- SC-003: A descriptor parity check confirms all server tools are represented in the submission artifact.
- SC-004: Evidence Drawer displays source document, section path, document hash, and validation status for at least three representative answers.
- SC-005: Golden evals cover at least 10 prompts and include AGI M130, Flow Code, NO_EVIDENCE, stale-source compliance, and invoice/cost guard scenarios.
- SC-006: Secret Scanning and Push Protection are enabled, Dependabot alerts/security updates are either enabled or explicitly documented with owner-approved deferral, and Code Scanning is configured with at least one completed run or documented as pending with the exact missing setup step.
- SC-007: No committed file contains `RAILWAY_API_TOKEN`, `OPENAI_API_KEY`, `ghp_`, `gho_`, or `sk-` secret values.
- SC-008: Local verification and GitHub Actions verification both pass before any release-ready claim.
- SC-009: After `npm run index`, regenerated `data/index/corpus_index.json` and `data/index/corpus_inventory.csv` match the committed files, or CI fails before merge.

## Open Questions & Clarifications

### Resolved Decisions

- Q1: Resolved. Cloudflare Workers production deployment MUST remain manual for Option B. CI MUST rebuild the corpus index and run verification after ontology, corpus, app contract, or workflow changes, but CI MUST NOT deploy automatically to Cloudflare. A Cloudflare deployment MAY start only after local verification passes, GitHub Actions verification passes, the release owner records explicit deployment approval, and required deployment secrets and rollback steps are confirmed outside the public repository. CI-based Cloudflare deployment is deferred to Option C or a later approved change.
- Q2: Resolved. `data/index/` MUST stay committed as reviewable generated artifacts for Option B. The files are derived from `data/corpus/` and MUST NOT be hand-edited except for explicitly documented mapping files such as `source_role_map.json`. CI MUST run `npm run index` before verification and MUST fail if regenerated `data/index/corpus_index.json` or `data/index/corpus_inventory.csv` differs from the committed files. Deployment SHOULD regenerate the index during build or verify that the committed index matches the current corpus before serving.
- Q3: Resolved. The repository is public, so the Option B security baseline can use GitHub public-repository security features without treating the GitHub plan as a blocker. Current observed status from `gh api`: Secret Scanning is enabled, Secret Scanning Push Protection is enabled, Dependabot security updates are disabled, secret scanning non-provider patterns are disabled, and secret scanning validity checks are disabled. Dependabot alerts status and Code Scanning configuration still require setup or explicit owner-approved deferral during implementation. Non-provider patterns and validity checks are optional hardening, not Option B blockers.
- Q4: Resolved. GitHub Projects is deferred to Option C. Option B will define only lightweight tracking fields through GitHub Issues, PR checklist, or a simple markdown status table. Option B must not require GitHub Projects board automation, Cloudflare auto-deploy, or release/approval workflow automation.

### Clarifications Log

- 2026-05-10 Session:
  - Q: Should the repository upload all files or only a minimum public scope? -> A: User requested full upload.
  - Q: Which improvement option should be specified first? -> A: `docs/operations/plan.md` recommends Option B, pending approval.
  - Q: Should Cloudflare deploy automatically from CI in Option B? -> A: No. Cloudflare production deployment remains manual and approval-gated.
  - Q: Should `data/index/` remain committed? -> A: Yes. It remains committed as reviewable generated evidence, with CI drift checks required.
  - Q: Which GitHub security features are confirmed now? -> A: Secret Scanning and Push Protection are enabled; Dependabot security updates are disabled; Code Scanning setup remains pending.
  - Q: Should GitHub Projects be included in Option B? -> A: No. GitHub Projects automation is deferred to Option C; Option B keeps lightweight tracking fields only.

## Risks & Mitigations

- R1: Public repository exposes operational documents. -> Mitigation: keep public disclosure visible and add secret/PII scanning checks.
- R2: CI passes but live Cloudflare deployment is stale. -> Mitigation: track CI status and live MCP status separately.
- R3: Evidence UI changes break ChatiPT rendering. -> Mitigation: require text fallback and browser/component smoke checks.
- R4: Golden evals become too brittle. -> Mitigation: validate verdict, evidence requirements, and blocking behavior instead of exact prose.
- R5: GitHub security features are account-dependent. -> Mitigation: document enabled/unavailable/pending state with evidence.

## Traceability

| Item | Links to |
|---|---|
| User Story 1 | FR-001, FR-002, FR-003, SC-001, SC-002 |
| User Story 2 | FR-004, FR-005, SC-003 |
| User Story 3 | FR-006, FR-007, SC-004 |
| User Story 4 | FR-008, SC-005 |
| User Story 5 | FR-009, FR-012, SC-006, SC-007 |
| User Story 6 | FR-010, FR-011, FR-013, SC-008, SC-009 |

## Approval Readiness Checklist

- [x] No critical clarification markers remain.
- [ ] Phase 1 plan approval is recorded.
- [ ] Implementation scope is confirmed as Option B or revised.
- [x] Security feature availability is checked in GitHub and unresolved setup items are documented.
- [x] Deployment automation policy is explicitly deferred for Option B.

## Changelog

- v0.1.0 (2026-05-10): Initial improvement spec drafted from `docs/operations/plan.md` Phase 1.
- v0.1.1 (2026-05-10): Resolved Open Questions Q1-Q4 using multi-agent consultation and current repository evidence.
