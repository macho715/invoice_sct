# SCT Ontology Improvement Execution Plan

## Overview

This plan converts the DOCX draft `SCT_Ontology_Improvement_Plan_DocumentType_RateBasis_CustomsInspection_Override.docx` into an execution-ready plan for the `DSV Invoice Audit & Final Validator PRO` GPT Actions flow.

The improvement focuses on three gaps observed in the current SCT ontology workflow:

1. Document terms such as BOE, CI/PL, and POD need first-class `DocumentType` mappings.
2. Rate basis terms such as AT COST and AS PER OFFER need first-class `RateBasis` mappings.
3. `CUSTOMS INSPECTION FEE` must override generic Customs matching and classify as TYPE-B `Inspection`.

Assumption: the deployed Worker remains the GPT Action backend at `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`, and the public Action schema continues to expose read-only and dry-run endpoints.

## Goals

1. Resolve BOE, CI/PL, POD, DO, storage invoice, terminal invoice, approval evidence, and vendor or broker invoice as `DocumentType` ontology nodes.
2. Resolve AT COST, AS PER OFFER, TARIFF, CONTRACT_NUMERIC, MISSING, and CONFLICT as `RateBasis` ontology nodes.
3. Force `customs inspection` and `inspection fee` terms to TYPE-B `Inspection` before any generic Customs classification rule runs.
4. Keep final PASS blocked when final subtotal before VAT, evidence status, rate basis, or Line_Audit to TYPE-B tie-out is incomplete.
5. Keep all GPT Action and MCP behavior read-only, dry-run, and masked.

## Scope

### In Scope

1. Ontology seed/schema extension for `DocumentType` and `RateBasis`.
2. Resolver synonym rules for BOE, CI/PL, POD, AT COST, AS PER OFFER, and related terms.
3. TYPE-B classifier priority rule for Customs Inspection.
4. Evidence map changes linking ChargeType, DocumentType, RateBasis, and required evidence.
5. Gate-check changes for AMBER, ZERO, and PASS blocking conditions.
6. OpenAPI/GPTS schema alignment for the existing Action operations.
7. Regression tests for GPT Action endpoints and local Worker routes.
8. Masked audit trace behavior for shipment, BL, BOE, TRN, container, and rate references.

### Out of Scope

1. Raw contract rate disclosure.
2. Raw BL, BOE, TRN, container number, shipment number, person name, email, or approval text storage in public payloads.
3. ERP, TMS, WMS, payment, or invoice approval execution.
4. Reclassifying true Customs Clearance, Customs Duty, or Bill of Entry Fee as Inspection.
5. Final invoice PASS when final subtotal before VAT is missing.

## Constraints

1. GPT Actions must remain read-only and dry-run.
2. Worker endpoints must support the Action paths currently used by GPTS:
   - `POST /ontology/resolve`
   - `POST /ontology/evidence-map`
   - `POST /ontology/gate-check`
   - `POST /ontology/crosswalk`
   - `POST /ontology/audit-trace`
   - `POST /dry-run/validate`
   - `POST /dry-run/type-b-classify`
   - `POST /dry-run/rate-lookup`
3. `/mcp/...` aliases may remain for compatibility, but OpenAPI should point to the root Action paths unless the GPT configuration intentionally uses `/mcp`.
4. Rate lookup must return status only: `MATCH`, `PARTIAL`, `MISSING`, or `CONFLICT`.
5. Cloudflare Worker implementation must avoid hardcoded secrets, request-scoped global state, and unmasked structured logs.
6. ChatGPT Action instructions must state that Action failure permits Knowledge fallback only for AMBER/ZERO analysis, not final PASS.

## Phases

### Phase 0. Baseline Freeze

Capture the current deployed Action behavior before changing rules.

Tasks:

1. Save current GPTS preview evidence for `resolveSctOntologyTerm`, `mapRequiredEvidence`, and `checkSctOntologyGate`.
2. Freeze the current unmapped and over-classified terms.
3. Freeze the current OpenAPI schema and Worker route list.

Deliverables:

1. Baseline gap register.
2. Golden input term set.
3. Current endpoint response snapshot.

Review criteria:

1. BOE, CI/PL, POD, AT COST, AS PER OFFER, CUSTOMS INSPECTION FEE, and BILL OF ENTRY FEE are reproducible test inputs.
2. Current UNKNOWN or over-classified behavior is documented before patching.

### Phase 1. Ontology Seed And Schema Patch

Add `DocumentType` and `RateBasis` nodes.

Tasks:

1. Add `SCT.DOC.BOE`, `SCT.DOC.CI_PL`, `SCT.DOC.POD`, `SCT.DOC.DO`, `SCT.DOC.STORAGE_INVOICE`, `SCT.DOC.TERMINAL_INVOICE`, `SCT.DOC.APPROVAL`, and `SCT.DOC.VENDOR_INVOICE`.
2. Add `SCT.RATE.CONTRACT_NUMERIC`, `SCT.RATE.AT_COST`, `SCT.RATE.AS_PER_OFFER`, `SCT.RATE.TARIFF`, `SCT.RATE.MISSING`, and `SCT.RATE.CONFLICT`.
3. Add synonyms from the DOCX draft.
4. Add risk defaults and evidence relationships.

Deliverables:

1. Ontology seed patch.
2. Schema or type update.
3. Resolver test payloads.

Review criteria:

1. BOE, CI/PL, and POD resolve with confidence `>= 0.85`.
2. AT COST and AS PER OFFER resolve as `RateBasis`.
3. Unknown fallback remains available for non-logistics noise terms.

### Phase 2. Customs Inspection Override Patch

Add the highest-priority override rule.

Tasks:

1. Match `customs inspection`, `inspection fee`, and close variants before generic Customs rules.
2. Return `SCT.CHARGE.CUSTOMS_INSPECTION`.
3. Return TYPE-B `Inspection`.
4. Preserve Customs classification for Customs Clearance, Customs Duty, Bill of Entry Fee, and SHJ Customs Code Opening.

Deliverables:

1. Classifier priority patch.
2. Override regression tests.
3. TYPE-B crosswalk update if required.

Review criteria:

1. `CUSTOMS INSPECTION FEE` always maps to TYPE-B `Inspection`.
2. `CUSTOMS CLEARANCE` remains TYPE-B `Customs`.
3. `BILL OF ENTRY FEE` remains TYPE-B `Customs` and links to BOE evidence.

### Phase 3. Evidence Map Patch

Link ChargeType, DocumentType, RateBasis, and required evidence.

Tasks:

1. Add Customs evidence: BOE, broker invoice, CI/PL, and customs approval evidence.
2. Add Inspection evidence: inspection approval, broker/customs invoice, and BOE remark when applicable.
3. Add AT COST evidence: vendor/broker invoice, approval evidence, and amount match.
4. Add AS PER OFFER evidence: offer approval, client approval, and line amount match.
5. Preserve existing DO, STROAGE, THC, and INLAND evidence behavior.

Deliverables:

1. Evidence relation patch.
2. Evidence status rules.
3. GPT Action `mapRequiredEvidence` test cases.

Review criteria:

1. Missing BOE or CI/PL produces `PARTIAL` or `MISSING`, not PASS.
2. Missing AT COST support keeps the line AMBER.
3. Missing AS PER OFFER approval keeps the line AMBER.

### Phase 4. Gate And Final Recon Patch

Make gate-check and final validation enforce blocking rules consistently.

Tasks:

1. Block final PASS when final subtotal before VAT is missing.
2. Block PASS when rate basis is `MISSING` or `CONFLICT`.
3. Treat HS/UAE, DEM/DET, OOG/stowage, and final reconciliation evidence gaps as ZERO candidates.
4. Keep AMBER available for incomplete support that is reviewable but not approval-ready.

Deliverables:

1. Gate-check rule patch.
2. `dryRunValidateInvoicePack` regression payload.
3. Final reconciliation decision matrix.

Review criteria:

1. Missing final subtotal before VAT returns ZERO or pending final subtotal status.
2. PASS requires evidence status, rate basis status, and TYPE-B tie-out.
3. Action output includes reviewer action, not only a verdict.

### Phase 5. Line Audit And Submission Pack Mapping

Propagate ontology results into the invoice audit output.

Tasks:

1. Add or standardize `sct_code`.
2. Add or standardize `sct_class`.
3. Add or standardize `document_type_code`.
4. Add or standardize `rate_basis_code`.
5. Add or standardize `type_b_rule_source`.
6. Add or standardize `classification_confidence`.
7. Add or standardize `evidence_status`.
8. Add or standardize `gate_result`.
9. Add or standardize `reviewer_action`.

Deliverables:

1. Line_Audit mapping update.
2. 7-sheet submission pack mapping update.
3. Reviewer action template update.

Review criteria:

1. Line_Audit can explain whether a value came from Action, Override, Fallback Keyword, or Manual Review.
2. TYPE-B summary and final reconciliation totals remain tied out.
3. `ROUNDUP(2)` disclosure remains visible where calculated totals are not rounded.

### Phase 6. OpenAPI And GPTS Action Alignment

Keep the GPT Action schema and Worker behavior synchronized.

Tasks:

1. Confirm operation IDs match the GPTS action buttons:
   - `resolveSctOntologyTerm`
   - `mapRequiredEvidence`
   - `checkSctOntologyGate`
   - `crosswalkSctToTypeB`
   - `createOntologyAuditTrace`
   - `dryRunValidateInvoicePack`
   - `dryRunClassifyTypeB`
   - `dryRunRateLookup`
2. Confirm OpenAPI server URL points to `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`.
3. Confirm schema examples include DocumentType, RateBasis, and Customs Inspection cases.
4. Confirm GPTS instructions forbid final PASS after Action failure.

Deliverables:

1. Updated OpenAPI schema.
2. Updated GPT instructions if needed.
3. GPTS preview test script or checklist.

Review criteria:

1. GPTS preview shows `ACTION_CALLED: YES`.
2. GPTS preview shows `SCT_ONTOLOGY_USED: YES`.
3. Evidence-map and gate-check no longer produce `NO_ROUTE_404`.

### Phase 7. Regression Test And Deployment

Deploy only after local and live checks pass.

Tasks:

1. Run local typecheck.
2. Run Worker unit tests.
3. Run dry-run smoke tests.
4. Deploy with Wrangler.
5. Re-test live endpoints.
6. Re-test GPTS preview actions.

Deliverables:

1. Test result report.
2. Wrangler deployment version.
3. GPTS preview evidence screenshots or transcript.

Review criteria:

1. Local tests pass.
2. Live Worker endpoint tests pass.
3. GPTS action calls return the expected mappings.
4. Existing DO, Customs, STROAGE, THC, and INLAND behavior does not regress.

## Golden Test Cases

| Test ID | Input | Expected Result | Pass Criteria |
|---|---|---|---|
| TC-DOC-001 | BOE / Bill of Entry / Customs Declaration | `SCT.DOC.BOE` | DocumentType confidence `>= 0.85` |
| TC-DOC-002 | CI/PL / CIPL / Invoice and Packing List | `SCT.DOC.CI_PL` | Customs evidence map includes CI/PL |
| TC-DOC-003 | POD / delivery proof | `SCT.DOC.POD` | INLAND evidence map includes POD |
| TC-RATE-001 | AT COST / at actuals / as per actuals | `SCT.RATE.AT_COST` | Missing support keeps AMBER |
| TC-RATE-002 | AS PER OFFER / per offer | `SCT.RATE.AS_PER_OFFER` | Missing approval keeps AMBER |
| TC-OVR-001 | CUSTOMS INSPECTION FEE | TYPE-B `Inspection` | Override beats generic Customs |
| TC-OVR-002 | BILL OF ENTRY FEE | TYPE-B `Customs` | BOE evidence relation exists |
| TC-GATE-001 | Final subtotal before VAT missing | ZERO or pending final subtotal | Final PASS is blocked |

## Risks

1. If Customs Inspection override runs after generic Customs rules, inspection charges will remain over-classified as Customs.
2. If RateBasis remains a keyword-only fallback, AT COST and AS PER OFFER lines may show evidence gaps without explaining the rate source.
3. If DocumentType is not propagated to Line_Audit, reviewers cannot trace why BOE or CI/PL evidence is required.
4. If GPTS schema and Worker routes drift, Action calls may return 404 again even when the Worker has the logic.
5. If raw rate or shipment identifiers leak into Action output, the dry-run control layer violates the privacy design.

## Review Criteria

The improvement is acceptable only when all of these checks pass:

1. `resolveSctOntologyTerm` resolves DocumentType and RateBasis examples.
2. `dryRunClassifyTypeB` classifies `CUSTOMS INSPECTION FEE` as Inspection.
3. `mapRequiredEvidence` returns required evidence for Customs, Inspection, AT COST, and AS PER OFFER.
4. `checkSctOntologyGate` blocks final PASS when final subtotal before VAT is missing.
5. `dryRunRateLookup` returns status only and does not expose raw rates.
6. `createOntologyAuditTrace` stores or returns masked references only.
7. GPTS preview confirms `ACTION_CALLED: YES` and `SCT_ONTOLOGY_USED: YES`.

## Deliverables

1. Ontology seed/schema patch for `DocumentType` and `RateBasis`.
2. Classifier override patch for Customs Inspection.
3. Evidence map patch for DocumentType and RateBasis support.
4. Gate-check patch for final subtotal and rate basis blockers.
5. Line_Audit and 7-sheet output mapping update.
6. OpenAPI schema and GPTS instruction alignment.
7. Regression test report.
8. Live Cloudflare Worker deployment evidence.
9. GPTS preview evidence.

## Definition Of Done

1. BOE, CI/PL, and POD resolve as DocumentType.
2. AT COST and AS PER OFFER resolve as RateBasis.
3. CUSTOMS INSPECTION FEE resolves to TYPE-B `Inspection`.
4. BILL OF ENTRY FEE resolves to TYPE-B `Customs` and links to BOE evidence.
5. Line_Audit retains SCT code, document type code, rate basis code, evidence status, and gate result.
6. Final subtotal before VAT missing blocks final PASS.
7. ROUNDUP two-decimal disclosure remains visible where applicable.
8. Regression tests prove existing DO, Customs, STROAGE, THC, and INLAND behavior is not broken.

