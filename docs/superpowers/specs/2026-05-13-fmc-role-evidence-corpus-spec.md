# Feature Specification: FMC Role Evidence Corpus Integration

Feature ID: `fmc-role-evidence-corpus`
Created: 2026-05-13
Status: Draft
Owner: HVDC Ontology / MCP maintainer
Input: Integrate `HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md` into the existing system. User allows names and emails to be exposed.
Design Source: `docs/superpowers/specs/2026-05-13-fmc-role-evidence-corpus-design.md`
Plan Source: `docs/superpowers/plans/2026-05-13-fmc-role-evidence-corpus-plan.md`

## Summary

### Problem

The current MCP corpus can answer general HVDC logistics questions, but FMC person, role, owner, escalation, and milestone-responsibility questions do not yet use the final FMC role analysis document as searchable evidence.

### Goals

- G1: Add the FMC Role Analysis combined document as a searchable corpus source.
- G2: Route role, owner, person, escalation, ActorRole, and milestone-owner questions to the FMC role corpus.
- G3: Keep `CONSOLIDATED-00-master-ontology` as the canonical semantic spine for role answers.
- G4: Preserve the user-approved privacy boundary: names and emails are allowed; phone numbers and token-like strings remain excluded or masked.
- G5: Verify the integration with index regeneration, role evidence tests, and full `npm run verify`.

### Non-Goals

- NG1: Do not rewrite ontology master classes around individual people.
- NG2: Do not promote personal names into canonical classes.
- NG3: Do not add phone numbers.
- NG4: Do not add live KG, ERP, WMS, ATLP, Foundry, email, WhatsApp, or other production write-back behavior.
- NG5: Do not weaken Human-gate rules for send, approve, publish, export, or write actions.
- NG6: Do not change the OAuth/upload/write tool design from prior Cloudflare work.

## User Scenarios & Testing

### User Story 1: Person Responsibility Lookup (Priority: P1)

An HVDC user asks what a named FMC person owns or supports.

Why this priority: person-specific ownership questions are the direct reason to add the FMC role corpus.

Independent Test: ask a question containing `Arvin`, `FANR`, and `BOE`; verify that retrieved evidence includes the new FMC role corpus.

Acceptance Scenarios:

1. Given the FMC role corpus is present under `data/corpus/`, When the user asks `Arvin FANR BOE 담당 업무`, Then `route_question` includes `CONSOLIDATED-00-master-ontology` and the FMC role corpus in `requiredDocs`.
2. Given the same question, When `ask_hvdc_ontology` runs, Then at least one returned `EvidenceSnippet.docId` is `HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined`.
3. Given the answer is rendered, When the Evidence Drawer is shown, Then it exposes the FMC role document section path and snippet as evidence.

### User Story 2: Milestone Owner Lookup (Priority: P1)

An HVDC user asks who owns a logistics milestone such as M115, M116, M117, M130, or M160.

Why this priority: milestone owner routing is a core operational use of the role analysis document.

Independent Test: ask `M115 담당자 누구야?`; verify that the answer searches the FMC role corpus and retains the master ontology route.

Acceptance Scenarios:

1. Given the user asks `M115 담당자 누구야?`, When `route_question` runs, Then required docs include `CONSOLIDATED-00-master-ontology` and the FMC role corpus.
2. Given the FMC role corpus contains M115 role sections, When search runs, Then evidence references the FMC role corpus and does not invent owner names.
3. Given evidence is missing, When no FMC role snippet supports the answer, Then the existing `NO_EVIDENCE` or review behavior remains active.

### User Story 3: Role Boundary Lookup (Priority: P2)

An HVDC user asks for a boundary between two or more FMC roles.

Why this priority: the source document explicitly contains role-boundary analysis.

Independent Test: ask a boundary question involving Arvin and Haitham or Roldan; verify evidence comes from the role corpus.

Acceptance Scenarios:

1. Given a role-boundary question, When the router detects role/person terms, Then the FMC role corpus is included in search scope.
2. Given evidence is returned, When the answer summarizes the boundary, Then the answer cites FMC role evidence rather than only generic operations evidence.
3. Given the question requests a write, send, publish, export, or approval action, When validation runs, Then Human-gate remains required.

### User Story 4: Privacy Boundary Preservation (Priority: P1)

The user allows names and emails for this integration, but phone numbers remain outside the approved scope.

Why this priority: privacy rules are a hard acceptance boundary for this corpus.

Independent Test: scan output fixtures and role answer results for phone-number leakage.

Acceptance Scenarios:

1. Given the source document contains names, When it is copied into `data/corpus/`, Then names remain available for evidence retrieval.
2. Given the source document contains email values, When the runtime redactor handles snippets, Then existing behavior may still mask real email addresses unless redaction policy is separately changed.
3. Given the source document or generated answer contains phone-like strings, When tests run, Then phone numbers are absent or masked.

### Edge Cases

- EC1: The source document path is missing or renamed. The implementation must stop before index generation.
- EC2: The new role corpus increases bundle size. The Worker dry-run must still pass.
- EC3: The router over-matches generic `owner` or `action` words. Regression tests must prove at least the target FMC role prompts route correctly without weakening Human-gate behavior.
- EC4: The source contains unmasked emails. Existing redaction may mask them in snippets; answer-visible real email output requires a separate redaction-policy change.
- EC5: The source contains phone numbers. They must not appear in answer output.

## Requirements

### Functional Requirements

- FR-001: The system MUST include `data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md` as a searchable corpus document.
- FR-002: The system MUST register the new corpus in `data/index/source_role_map.json`.
- FR-003: The router MUST include the FMC role corpus for role, owner, person, escalation, ActorRole, and milestone-owner questions.
- FR-004: The router MUST continue to include `CONSOLIDATED-00-master-ontology` for role evidence answers.
- FR-005: `search_ontology_corpus` MUST be able to return `EvidenceSnippet` items from the FMC role corpus.
- FR-006: `ask_hvdc_ontology` MUST preserve the existing `GroundedAnswer` shape when answering FMC role questions.
- FR-007: The Evidence Drawer MUST show FMC role corpus evidence with document ID, section path, hash, and snippet.
- FR-008: The integration MUST NOT create write-back, send, approval, export, or publication behavior.
- FR-009: Human-gate validation MUST remain active for write, send, export, report publication, invoice, cost, or approval requests.
- FR-010: The implementation MUST preserve names in source corpus evidence where role routing requires them.
- FR-011: The implementation MUST NOT introduce phone numbers into answer output.
- FR-012: The implementation MUST keep token-like strings masked.
- FR-013: The implementation MUST regenerate `data/index/corpus_index.json` and `data/index/corpus_inventory.csv`.
- FR-014: The implementation MUST regenerate Worker corpus assets through the existing verification flow.

### Non-Functional Requirements

- NFR-001 (Traceability): FMC role answers must cite `EvidenceSnippet` records from the new corpus when making person or milestone responsibility claims.
- NFR-002 (Security/Privacy): Phone numbers and token-like strings must be absent or masked in answer output and test fixtures.
- NFR-003 (Compatibility): Existing non-role golden prompts must continue to pass.
- NFR-004 (Maintainability): The new corpus must be registered through existing corpus and source-role-map mechanisms, not through a separate ad hoc search path.
- NFR-005 (Operational Safety): The integration must not weaken existing Human-gate or OAuth/upload/write protections.

## Assumptions & Dependencies

### Assumptions

- A1: The source document remains available at the provided local path during implementation.
- A2: The current source document uses masked email values such as `ar***@samsung.com`.
- A3: Names are operationally allowed in this integration.
- A4: Emails are allowed by user instruction, but existing runtime redaction may still mask real email addresses unless separately changed.
- A5: Phone numbers remain unapproved for output.

### Dependencies

- D1: `scripts/index_corpus.py` for `data/index` regeneration.
- D2: `scripts/generate_worker_assets.py` for Worker runtime corpus generation.
- D3: `server/src/router.ts` for route selection.
- D4: `server/src/corpus.ts` for corpus search behavior.
- D5: `server/src/redact.ts` for PII masking.
- D6: `tests/golden_prompts.json` and `tests/evals.test.ts` for regression coverage.
- D7: `npm run verify` for typecheck, Vitest, and Worker dry-run.

## Success Criteria

- SC-001: `data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md` exists after implementation.
- SC-002: `data/index/source_role_map.json` includes `HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined`.
- SC-003: `route_question("Arvin FANR BOE 담당 업무")` includes the FMC role corpus and `CONSOLIDATED-00-master-ontology`.
- SC-004: At least one golden/eval prompt retrieves `EvidenceSnippet.docId = "HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined"`.
- SC-005: `npm run index` completes and updates corpus inventory/index.
- SC-006: `npm run verify` passes.
- SC-007: Phone-number leakage is not introduced into role answer output.
- SC-008: Existing Human-gate behavior remains active for action/send/export/report/approval requests.
- SC-009: Active docs mention the new FMC role evidence corpus where corpus inventory, architecture, QA state, or role-routing behavior is described.

## Open Questions

- None blocking for the current implementation scope.

## Clarifications Log

- 2026-05-13: User selected Approach A: integrate the FMC Role Analysis combined document as a first-class role evidence corpus.
- 2026-05-13: User explicitly allowed name and email exposure for this integration.
- 2026-05-13: Phone numbers were not approved for exposure and remain excluded or masked.

## Traceability

| Item | Links to |
|---|---|
| User Story 1 | FR-001, FR-002, FR-003, FR-004, FR-005, SC-001, SC-002, SC-003, SC-004 |
| User Story 2 | FR-003, FR-004, FR-005, FR-006, SC-003, SC-004 |
| User Story 3 | FR-003, FR-007, FR-008, FR-009, SC-004, SC-008 |
| User Story 4 | FR-010, FR-011, FR-012, NFR-002, SC-007 |
| Index regeneration | FR-013, FR-014, SC-005, SC-006 |
| Documentation refresh | SC-009 |

## Reviewer Checklist

- The spec contains all mandatory sections.
- Every FR/NFR/SC uses a stable ID.
- Each P1 scenario has an independent test.
- No critical ambiguity remains.
- No implementation code is included.
- Success criteria are measurable.
- Out-of-scope items preserve current system safety boundaries.
