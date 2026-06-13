# Evidence Trace Mode Spec

Status: Draft - Trace decisions resolved
Source Plan: `docs/operations/evidence-trace-mode-plan.md`
Created: 2026-05-11

## Summary

Evidence Trace Mode improves evidence quality in the HVDC Ontology Grounded ChatGPT App.

The feature must connect major answer statements to the evidence that supports them, then show those connections in the Answer Card and Evidence Drawer.

This spec does not add new tools, new corpus meaning, external write-back, or evidence scoring.

## User Scenarios & Testing

### User Story 1 - Review Answer Support

As a user reviewing an HVDC answer, I need to see which evidence supports each major answer statement so that I can judge whether the answer is grounded.

Independent Test: A pipeline test can call `ask_hvdc_ontology` with a supported HVDC logistics question and verify that major answer fields include trace links to existing evidence IDs.

Acceptance Scenarios:

1. Given a supported question with matching corpus evidence, When `ask_hvdc_ontology` returns an answer, Then each major summary, detail, or action item has either at least one linked evidence ID or an explicit `NO_DIRECT_EVIDENCE` state.
2. Given an answer with linked evidence IDs, When the answer is rendered in the ChatGPT widget, Then the user can see evidence markers next to the supported answer content.
3. Given a supported answer rendered for Claude, When markdown output is generated, Then the evidence relationship remains visible in text form.

### User Story 2 - Inspect Evidence in Drawer

As a user checking the Evidence Drawer, I need to see the source document and the answer statement that the evidence supports so that I can review the answer without guessing the connection.

Independent Test: A widget test can load the HTML and fixture state, then verify that evidence rows include source information and connected answer text without using external fetch or remote resources.

Acceptance Scenarios:

1. Given an answer with evidence trace links, When the Evidence Drawer is opened, Then each visible evidence item shows the document/source identifier, section path, raw evidence ID, and connected answer statement.
2. Given multiple answer statements using the same evidence, When the Evidence Drawer is opened, Then the evidence item can show multiple connected answer statements without duplicating business facts.
3. Given long evidence text or long action text, When the widget renders, Then the content stays readable and does not overflow the card.

### User Story 3 - Preserve Blocked and No-Evidence Behavior

As a reviewer, I need unsupported answers to stay blocked or marked as no evidence so that evidence markers do not create false confidence.

Independent Test: A pipeline or eval test can call known no-evidence and blocked scenarios and verify that no unsupported trace links are created.

Acceptance Scenarios:

1. Given a question with no relevant corpus support, When `ask_hvdc_ontology` returns `NO_EVIDENCE`, Then the response does not attach invented evidence links.
2. Given a question that must block under validation rules, When the answer is rendered, Then trace display does not weaken the `BLOCK` or validation status.
3. Given UI rendering fails or falls back to text, When the fallback is shown, Then business fields such as `verdict`, `validationStatus`, `evidenceIds`, and `actions` remain unchanged.

## Requirements

### Functional Requirements

- FR-001: The system MUST add a traceable answer-to-evidence mapping to the `ask_hvdc_ontology` result for major answer fields.
- FR-002: The mapping MUST reference existing evidence IDs and MUST NOT create evidence IDs that are absent from the returned evidence list.
- FR-003: The mapping MUST cover summary, details, and actions when those fields are present and evidence-supported.
- FR-004: The mapping MUST preserve an explicit `NO_DIRECT_EVIDENCE` state for answer content that cannot be linked to evidence.
- FR-005: The ChatGPT Answer Card MUST show short display labels such as `E1` and `E2` near supported answer content while preserving raw `evidence.id` values in data.
- FR-006: The Evidence Drawer MUST show document/source identifier, `sectionPath`, raw evidence ID, evidence text, and connected answer statement text for mapped evidence.
- FR-007: The Claude markdown renderer MUST preserve the evidence relationship in readable text form.
- FR-008: The system MUST keep previously implemented read/render tool names unchanged. Later protected upload/write tools are additive and must be covered by descriptor parity tests.
- FR-009: The system MUST keep `NO_EVIDENCE` and `BLOCK` behavior intact and MUST NOT attach invented support in those states.
- FR-010: The system MUST keep UI render failures isolated from business result fields.
- FR-011: The implementation MUST update relevant pipeline, widget, descriptor, and Claude descriptor tests when behavior or contracts change.
- FR-012: Unsupported answer content MUST remain visible with a non-clickable `No direct evidence` label and MUST NOT create fake Evidence Drawer rows.

### Trace Payload Contract

The answer trace payload MUST use a minimal structure that keeps raw evidence IDs separate from display labels.

Each trace item MUST include:

- `targetType`: `summary`, `businessImpact`, `detail`, or `action`
- `targetIndex`: zero-based index for repeated fields, or `null` for single fields
- `answerText`: the exact answer statement shown to the user
- `supportState`: `SUPPORTED` or `NO_DIRECT_EVIDENCE`
- `evidenceIds`: raw `EvidenceSnippet.id` values that exist in the same response

Display labels such as `E1` and `E2` are presentation labels derived from the returned `evidence` order. They MUST NOT replace raw evidence IDs in the response contract.

### Non-Functional Requirements

- NFR-001: Trace output MUST be readable by a reviewer without requiring internal code knowledge.
- NFR-002: Trace output MUST avoid weakening existing PII masking behavior.
- NFR-003: Widget changes MUST preserve the existing no-external-fetch and no-remote-resource boundary.
- NFR-004: The answer data structure SHOULD stay minimal enough to avoid duplicating full evidence text in multiple places.
- NFR-005: ChatGPT widget output and Claude markdown output MUST communicate the same evidence relationship, even if the presentation differs.

## Assumptions & Dependencies

### Assumptions

- Assumption: The work can be completed without changing corpus content.
- Assumption: Existing `EvidenceSnippet` IDs are stable enough to reference within one answer response.
- Assumption: A minimal trace structure is enough for this phase; evidence scoring remains out of scope.

### Dependencies

- D-001: `server/src/types.ts` defines the shared answer and evidence structures.
- D-002: `server/src/answer.ts` creates the grounded answer and validation status.
- D-003: `server/src/ui.ts` and `public/hvdc-answer-widget.html` carry and render ChatGPT widget state.
- D-004: `server/src/claude-render.ts` renders the Claude text representation.
- D-005: `tests/pipeline.test.ts`, `tests/widget.test.ts`, `tests/descriptor.test.ts`, and `tests/claude-descriptor.test.ts` verify behavior and contract boundaries.

## Success Criteria

- SC-001: A supported answer test proves that returned major answer content links to evidence IDs that exist in the same response.
- SC-002: A no-evidence test proves that unsupported answers do not include invented evidence links.
- SC-003: A blocked-answer test proves that trace display does not alter `BLOCK`, validation findings, or action gating.
- SC-004: A widget test proves that the Evidence Drawer shows source information, `sectionPath`, raw evidence ID, and connected answer statement text.
- SC-005: A widget test proves that the page still avoids external `fetch()` and `http(s)://` resource use.
- SC-006: A Claude renderer test proves that markdown output preserves the evidence relationship in text form.
- SC-007: Descriptor tests prove the currently implemented MCP tool names remain aligned with submission metadata.
- SC-008: `npm run verify` completes successfully after the implementation.
- SC-009: A mixed supported/unsupported fixture proves that supported statements show display labels and unsupported statements show `No direct evidence` without fake evidence rows.

## Open Questions

- None for the current draft.

## Decisions

- Q-001: Use short display labels such as `E1` and `E2` in UI and Claude text, while preserving raw `evidence.id` values in the response data and Evidence Drawer metadata.
- Q-002: Show unsupported answer content with a visible non-clickable `No direct evidence` label. Do not hide the content and do not create fake evidence rows.

## Clarifications Log

- 2026-05-11: User selected Evidence quality upgrade.
- 2026-05-11: User selected both answer-evidence connection and Evidence Drawer improvement.
- 2026-05-11: User approved the Plan before this Spec was drafted.
- 2026-05-11: Multi-agent review resolved Q-001 as raw ID preservation plus short display labels.
- 2026-05-11: Multi-agent review resolved Q-002 as visible `No direct evidence` labels without fake evidence rows.

## Reviewer Checklist

- Confirm all functional requirements trace back to the approved Plan.
- Confirm no new MCP tool, new corpus meaning, evidence scoring, or external write-back slipped into scope.
- Confirm success criteria are testable through existing command boundaries.
- Confirm the current draft has no unresolved critical open questions before marking this spec approved.
