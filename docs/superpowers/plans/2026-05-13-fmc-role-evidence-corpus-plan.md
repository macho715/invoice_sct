# FMC Role Evidence Corpus Integration Plan

Date: 2026-05-13
Status: Draft for approval
Design source: `docs/superpowers/specs/2026-05-13-fmc-role-evidence-corpus-design.md`

## Overview

This plan integrates the FMC Role Analysis combined document into the existing HVDC MCP corpus so role, owner, escalation, milestone responsibility, and person-specific questions can retrieve evidence from that document.

Input document:

```text
C:\Users\jichu\Downloads\HVDC Ontology Grounded\HVDC_FINAL_10x_2026-04-27\HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md
```

Target corpus document:

```text
data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md
```

## Goals

- Add the FMC Role Analysis combined document as a searchable role evidence corpus.
- Route role, owner, person, escalation, ActorRole, and milestone owner questions to the new corpus.
- Keep `CONSOLIDATED-00-master-ontology` as the canonical semantic spine.
- Preserve the user's current privacy boundary: names and emails are allowed; phone numbers and token-like strings remain excluded or masked.
- Verify the integration through index regeneration, tests, and full `npm run verify`.

## Scope

### In Scope

- Copy the provided FMC role document into `data/corpus/`.
- Register the new corpus in `data/index/source_role_map.json`.
- Update `server/src/router.ts` so role/person/owner questions include the FMC role corpus.
- Add or update golden prompt coverage for FMC role evidence retrieval.
- Regenerate corpus index artifacts.
- Update active documentation that lists corpus sources, layout, QA state, or role-routing behavior.
- Run verification before claiming completion.

### Out of Scope

- Do not rewrite ontology master classes around individual people.
- Do not promote personal names into canonical classes.
- Do not add phone numbers.
- Do not add live KG, ERP, WMS, ATLP, Foundry, email, WhatsApp, or other production write-back behavior.
- Do not weaken Human-gate rules for send, approve, publish, export, or write actions.
- Do not change the OAuth/upload/write tool design from the prior Cloudflare work.

## Constraints

- The repository reads runtime evidence from `data/corpus/*.md`.
- `scripts/index_corpus.py` generates `data/index/corpus_index.json` and `data/index/corpus_inventory.csv`.
- `scripts/generate_worker_assets.py` generates Worker runtime corpus assets.
- Existing PII masking currently masks real email addresses in retrieved snippets and user input.
- The current source document appears to contain masked email values such as `ar***@samsung.com`.
- Assumption: if the user later supplies unmasked email values and requires answer-visible email output, redaction policy changes must be handled as a separate scoped change.

## Phases

### Phase 1: Corpus Placement

Put the provided FMC role document under `data/corpus/` without modifying its content.

### Phase 2: Source Role Registration

Register the new document in `data/index/source_role_map.json` as a rank 3 role evidence corpus.

### Phase 3: Routing Update

Update routing so role/person/owner questions search the new corpus.

### Phase 4: Regression Coverage

Add tests or golden prompts that prove the new corpus is used for role questions.

### Phase 5: Index And Generated Assets

Run the existing index and verification commands so index and Worker generated assets match the corpus set.

### Phase 6: Documentation Refresh

Update active docs to mention the FMC role evidence corpus and the name/email privacy boundary.

## Tasks

1. Verify the source file exists at the exact provided path.
2. Copy the source file to `data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md`.
3. Add the new docId to `data/index/source_role_map.json`.
4. Patch `server/src/router.ts` with a role evidence routing rule.
5. Add FMC person and milestone-owner trigger coverage.
6. Add or update `tests/golden_prompts.json` with at least one FMC role question.
7. Update `tests/evals.test.ts` only if the golden prompt schema needs an additional expectation.
8. Run `npm run index`.
9. Run `npm run verify`.
10. Update `README.md`, `SYSTEM_ARCHITECTURE.md`, `LAYOUT.md`, and `docs/QA_REPORT.md` if their current corpus/source descriptions become stale.
11. Confirm no phone number text was introduced into answer output fixtures.
12. Commit the implementation after verification passes.

## Risks

- The source document is large enough that index chunk count and Worker bundle size will increase.
- Existing email redaction may still mask real email addresses even though this user allows email exposure.
- If role-routing patterns are too broad, unrelated owner/action questions may over-route to the FMC role corpus.
- If role-routing patterns are too narrow, person-specific questions may miss the new corpus.
- Phone numbers could enter the corpus if the source document contains them; this must be checked before completion.

## Review Criteria

- `data/corpus/HVDC_FMC_Role_Analysis_FINAL_10x_2026-04-27.combined.md` exists.
- `data/index/source_role_map.json` includes the new corpus docId.
- `route_question` selects the new corpus for role/owner/person questions.
- At least one golden prompt retrieves evidence from the new FMC role corpus.
- `npm run index` completes.
- `npm run verify` completes.
- Active documentation reflects the new role evidence corpus.
- Phone-number leakage is not introduced.

## Deliverables

- New corpus file under `data/corpus/`.
- Updated source role map.
- Updated router logic.
- Updated test or golden prompt coverage.
- Regenerated index and Worker corpus assets.
- Updated active docs.
- Verified implementation commit.
