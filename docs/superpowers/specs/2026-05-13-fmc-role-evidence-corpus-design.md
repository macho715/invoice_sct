# FMC Role Evidence Corpus Integration Design

Date: 2026-05-13
Status: Draft for user review

## Verdict

Use Approach A: add the FMC Role Analysis combined document as a first-class role evidence corpus.

## Source Document

Input document:

```text
C:\Users\jichu\Downloads\HVDC Ontology Grounded\HVDC_FINAL_10x_2026-04-27\HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md
```

Observed properties:

- The document is a combined final 10x FMC role corpus.
- It contains person-level role analysis, milestone responsibility, routing-pattern impact, role-boundary notes, ActorRole proposals, and DuckDB/email statistics.
- Names may remain visible under the current user instruction.
- Email visibility is allowed by the current user instruction, but phone numbers remain out of scope unless separately approved.

## Goal

Make MCP answers use the FMC role document when the user asks role, owner, escalation, milestone responsibility, or person-specific HVDC logistics questions.

Example questions this should support:

- Who owns FANR or BOE follow-up?
- What is Arvin responsible for?
- Who owns M115/M116/M117?
- Who is the MOSB/LCT coordinator?
- What is the role boundary between Arvin, Haitham, kEn, Roldan, Jhysn, and Ronnel?

## Non-Goals

- Do not rewrite the core ontology classes around individual people.
- Do not promote personal names into canonical master classes.
- Do not add phone numbers.
- Do not create ERP, WMS, ATLP, Foundry, email, WhatsApp, or other production write-back behavior.
- Do not weaken Human-gate requirements for send, approve, publish, export, or write actions.

## Chosen Architecture

Add a new corpus document under `data/corpus/`.

Planned target:

```text
data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md
```

Add it to the source role map:

```json
"HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined": {
  "rank": 3,
  "role": "FMC role evidence corpus for person, owner, milestone responsibility, and escalation questions"
}
```

Update routing so role questions include the new corpus alongside master ontology and communication/operations docs.

The router should select the FMC role corpus for:

- role / owner / 담당 / 책임자 / escalation questions
- known FMC people names and aliases
- milestone owner questions such as M90, M115, M130, M160
- ActorRole questions

## Data Flow

1. User asks a role or owner question.
2. `route_question` includes `CONSOLIDATED-00-master-ontology` and the FMC role corpus in `requiredDocs`.
3. `search_ontology_corpus` searches the new role corpus.
4. `ask_hvdc_ontology` returns the same GroundedAnswer shape.
5. Evidence Drawer shows the FMC role document section path and snippets.
6. Existing validation and Human-gate rules stay active.

## Privacy Boundary

The user explicitly allowed name and email exposure for this integration.

Implementation rule:

- Names can remain visible in corpus snippets and answers where role routing requires them.
- Emails can remain visible if the source document contains them.
- Phone numbers must remain excluded or masked.
- Token-like strings must remain masked.

Important note:

The current runtime redactor masks email addresses in retrieved snippets and user input. If the source document still contains masked emails such as `ar***@samsung.com`, no additional change is needed. If later the user supplies unmasked emails and requires answer-visible email output, the redactor policy must be changed as a separate implementation decision and covered by tests.

## Files To Change In Implementation

Expected files:

```text
data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md
data/index/source_role_map.json
server/src/router.ts
tests/evals.test.ts
tests/golden_prompts.json
README.md
SYSTEM_ARCHITECTURE.md
LAYOUT.md
docs/QA_REPORT.md
```

Expected generated files after indexing:

```text
data/index/corpus_index.json
data/index/corpus_inventory.csv
server/src/generated/corpus-data.ts
```

## Tests

Add or update tests for these outcomes:

- `route_question` includes the FMC role corpus for role/owner/person questions.
- Golden prompt for `Arvin FANR BOE 담당 업무` returns FMC role evidence.
- Golden prompt for `M115 담당자` returns marine/MOSB role evidence.
- Phone-number leakage remains absent.
- Existing `npm run verify` passes.

## Error Handling

If the copied corpus file is missing:

- fail during implementation before index generation.

If role evidence is not found:

- keep existing `NO_EVIDENCE` or `WARN` behavior.

If a question asks to send an email or publish a report:

- return Human-gate required and do not send anything.

## Acceptance Criteria

The integration is complete only when all conditions hold:

- The FMC role document is present under `data/corpus/`.
- `source_role_map.json` includes the new corpus.
- `npm run index` updates corpus inventory and index.
- `npm run verify` passes.
- At least one role/owner golden prompt retrieves evidence from the new corpus.
- Phone numbers are not introduced into answer output.

## Implementation Order

1. Copy the source document into `data/corpus/`.
2. Add the document to `data/index/source_role_map.json`.
3. Patch `server/src/router.ts` to route role/person/owner questions to the new corpus.
4. Add regression/golden prompts.
5. Run `npm run index`.
6. Run `npm run verify`.
7. Update docs with the new corpus role.
