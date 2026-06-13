# SCT Ontology Improvement Spec

## Summary

This specification defines the contract for improving the SCT ontology layer used by `DSV Invoice Audit & Final Validator PRO` GPT Actions.

The implementation must extend the ontology resolver, evidence mapper, TYPE-B classifier, gate checker, OpenAPI Action schema, and GPTS operating instructions so invoice audit decisions can distinguish:

1. logistics charge types,
2. supporting document types,
3. rate basis status,
4. Customs Inspection override behavior,
5. final PASS blockers.

The system must remain read-only, dry-run, masked, and non-mutating. It must not approve invoices, execute payment, mutate ERP/TMS/WMS records, or disclose raw contract rates.

Source plan: `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md`

Known local references:

1. `wrangler.toml` points this package to `server/src/worker.ts`.
2. `server/src/worker.ts` exposes root Action routes and `/mcp/...` aliases.
3. `openapi/hvdc_sct_ontology_actions.apikey.yaml` and `openapi/hvdc_sct_ontology_actions.noauth.yaml` expose GPT Action operations.
4. `gpts/GPT_INSTRUCTIONS_SCT_ONTOLOGY_ROUTER.md` requires Action calls before SCT-related final judgments.

## User Scenarios & Testing

### US-001. Resolve document terms as ontology nodes

Given a GPT Action request containing `BOE`, `Bill of Entry`, `CI/PL`, `CIPL`, `POD`, or `delivery proof`  
When `resolveSctOntologyTerm` is called  
Then the response must classify the term as a `DocumentType` where applicable  
And the result must include an SCT document code, confidence, risk level, and reviewer action.

Independent tests:

1. `BOE` resolves to `SCT.DOC.BOE`.
2. `CI/PL` resolves to `SCT.DOC.CI_PL`.
3. `POD` resolves to `SCT.DOC.POD`.

### US-002. Resolve rate basis terms as ontology nodes

Given a GPT Action request containing `AT COST`, `at actuals`, `AS PER OFFER`, or `per offer`  
When `resolveSctOntologyTerm` or rate basis classification is called  
Then the response must classify the term as a `RateBasis`  
And the response must not disclose any raw rate amount.

Independent tests:

1. `AT COST` resolves to `SCT.RATE.AT_COST`.
2. `AS PER OFFER` resolves to `SCT.RATE.AS_PER_OFFER`.
3. Missing supporting evidence keeps the result AMBER or ZERO, not PASS.

### US-003. Override Customs Inspection before generic Customs

Given an invoice line description `CUSTOMS INSPECTION FEE`  
When `resolveSctOntologyTerm` or `dryRunClassifyTypeB` is called  
Then the line must classify as `SCT.CHARGE.CUSTOMS_INSPECTION`  
And TYPE-B must be `Inspection`  
And generic Customs Clearance rules must not override this result.

Independent tests:

1. `CUSTOMS INSPECTION FEE` returns TYPE-B `Inspection`.
2. `CUSTOMS CLEARANCE` remains TYPE-B `Customs`.
3. `BILL OF ENTRY FEE` remains TYPE-B `Customs` and links to BOE evidence.

### US-004. Generate evidence requirements from SCT codes

Given mapped SCT charge, document, or rate basis codes  
When `mapRequiredEvidence` is called  
Then the response must return required evidence, evidence status, reviewer action, and gate relevance.

Independent tests:

1. Customs requires BOE, broker invoice, CI/PL, and customs approval evidence.
2. Inspection requires inspection approval, broker/customs invoice, and BOE remark when applicable.
3. AT COST requires vendor/broker invoice, approval evidence, and amount match.
4. AS PER OFFER requires offer approval, client approval, and line amount match.

### US-005. Block final PASS when critical gates are incomplete

Given an invoice audit payload missing final subtotal before VAT  
When `checkSctOntologyGate` or `dryRunValidateInvoicePack` is called  
Then final PASS must be blocked  
And the response must return ZERO or an explicit pending final subtotal blocker.

Independent tests:

1. Missing final subtotal before VAT returns `pass_allowed=false`.
2. Rate basis `MISSING` or `CONFLICT` blocks PASS.
3. HS/UAE, DEM/DET, OOG/stowage, and final reconciliation evidence gaps become ZERO candidates.

### US-006. Preserve GPTS Action observability

Given a GPTS preview test for an SCT-related question  
When the GPT calls the Action endpoint  
Then the answer must clearly report Action and ontology usage status.

Independent tests:

1. Successful Action result reports `ACTION_CALLED: YES`.
2. Successful ontology usage reports `SCT_ONTOLOGY_USED: YES`.
3. Endpoint failure reports the failure cause such as `NO_ROUTE_404`, `NO_AUTH`, `SCHEMA_ERROR`, `TIMEOUT`, `NO_MATCH`, or `INSUFFICIENT_INPUT`.

## Requirements

### Functional Requirements

| ID | Requirement | Trace |
|---|---|---|
| FR-001 | The resolver must support `DocumentType` as an ontology class. | US-001 |
| FR-002 | The resolver must map BOE and Bill of Entry variants to `SCT.DOC.BOE`. | US-001 |
| FR-003 | The resolver must map CI/PL and CIPL variants to `SCT.DOC.CI_PL`. | US-001 |
| FR-004 | The resolver must map POD and delivery proof variants to `SCT.DOC.POD`. | US-001 |
| FR-005 | The resolver must support `RateBasis` as an ontology class. | US-002 |
| FR-006 | The resolver must map AT COST, at actuals, and as per actuals variants to `SCT.RATE.AT_COST`. | US-002 |
| FR-007 | The resolver must map AS PER OFFER and per offer variants to `SCT.RATE.AS_PER_OFFER`. | US-002 |
| FR-008 | The classifier must evaluate Customs Inspection override rules before generic Customs rules. | US-003 |
| FR-009 | The classifier must map Customs Inspection to TYPE-B `Inspection`. | US-003 |
| FR-010 | The classifier must keep Customs Clearance, Customs Duty, and Bill of Entry Fee under TYPE-B `Customs`. | US-003 |
| FR-011 | Evidence mapping must link Customs charges to BOE, broker invoice, CI/PL, and customs approval evidence. | US-004 |
| FR-012 | Evidence mapping must link Inspection charges to inspection approval, broker/customs invoice, and BOE remark when applicable. | US-004 |
| FR-013 | Evidence mapping must link AT COST to vendor/broker invoice, approval evidence, and amount match. | US-004 |
| FR-014 | Evidence mapping must link AS PER OFFER to offer approval, client approval, and line amount match. | US-004 |
| FR-015 | Gate-check must block PASS when final subtotal before VAT is missing. | US-005 |
| FR-016 | Gate-check must block PASS when rate basis status is `MISSING` or `CONFLICT`. | US-005 |
| FR-017 | Gate-check must treat HS/UAE, DEM/DET, OOG/stowage, and final reconciliation gaps as ZERO candidates. | US-005 |
| FR-018 | `dryRunRateLookup` must return status only and never return raw contract rates. | US-002, US-005 |
| FR-019 | `createOntologyAuditTrace` must use masked references only. | US-006 |
| FR-020 | OpenAPI operation IDs must stay aligned with GPTS Action buttons. | US-006 |
| FR-021 | Worker routes must support the documented root paths and existing `/mcp/...` aliases. | US-006 |
| FR-022 | GPTS instructions must forbid final PASS if the Action call fails or ontology result is unavailable. | US-006 |
| FR-023 | Line_Audit output must retain `sct_code`, `sct_class`, `document_type_code`, `rate_basis_code`, `type_b_rule_source`, `classification_confidence`, `evidence_status`, `gate_result`, and `reviewer_action`. | US-001 to US-005 |
| FR-024 | Existing DO, THC, STROAGE, INLAND, and generic Customs behavior must not regress. | US-003 to US-005 |

### Non-Functional Requirements

| ID | Requirement | Trace |
|---|---|---|
| NFR-001 | All SCT Action behavior must remain read-only and dry-run. | Summary |
| NFR-002 | The Worker must not approve invoices, execute payments, or mutate ERP/TMS/WMS systems. | Summary |
| NFR-003 | The system must not expose raw contract rates, rate tables, raw BL, BOE, TRN, container number, shipment number, person data, email, or approval text in public Action output. | US-002, US-006 |
| NFR-004 | Responses must include enough reviewer action detail to support human review. | US-004, US-005 |
| NFR-005 | Error responses must be explicit enough for GPTS to distinguish route, auth, schema, timeout, no-match, and insufficient-input failures. | US-006 |
| NFR-006 | The implementation must be deployable to Cloudflare Workers with the package `wrangler.toml` route configuration or an explicitly confirmed deployment source. | Summary |
| NFR-007 | The implementation must be testable locally before Wrangler deployment. | US-001 to US-006 |
| NFR-008 | GPTS preview validation must be performed after deployment. | US-006 |

## API Contract

The following Action operations must remain available.

| Operation ID | Method | Path | Primary Contract |
|---|---:|---|---|
| `resolveSctOntologyTerm` | POST | `/ontology/resolve` | Resolve charge, document, and rate terms to SCT ontology mappings. |
| `explainSctOntologyNode` | POST | `/ontology/explain` | Explain a mapped SCT node without exposing private data. |
| `mapRequiredEvidence` | POST | `/ontology/evidence-map` | Return required evidence and evidence status for SCT codes. |
| `checkSctOntologyGate` | POST | `/ontology/gate-check` | Return PASS, PASS WITH WARNINGS, AMBER, FAIL, or ZERO gate result. |
| `crosswalkSctToTypeB` | POST | `/ontology/crosswalk` | Convert SCT code to TYPE-B and related hints. |
| `createOntologyAuditTrace` | POST | `/ontology/audit-trace` | Return masked audit trace data only. |
| `dryRunValidateInvoicePack` | POST | `/dry-run/validate` | Validate invoice pack readiness without executing approval. |
| `dryRunClassifyTypeB` | POST | `/dry-run/type-b-classify` | Classify invoice charge lines into TYPE-B. |
| `dryRunRateLookup` | POST | `/dry-run/rate-lookup` | Return masked private rate status only. |

Alias rule:

1. Each root path may also support `/mcp/...` alias paths.
2. OpenAPI should use the root paths unless GPTS is intentionally configured for `/mcp`.

## Data Contract

### Resolver Output Fields

| Field | Required | Contract |
|---|---:|---|
| `input` | Yes | Original term or normalized input reference. |
| `sct_code` | Yes | Final SCT code or `SCT.UNKNOWN`. |
| `sct_class` | Yes | One of `ChargeType`, `DocumentType`, `RateBasis`, `RiskGate`, `TypeB`, or equivalent current class naming. |
| `canonical_label` | Yes | Human-readable SCT label. |
| `type_b` | Conditional | Required for charge classification. |
| `confidence` | Yes | Numeric confidence from 0.00 to 1.00. |
| `risk` | Yes | PASS-related risk marker such as AMBER, HIGH, ZERO candidate, or equivalent current enum. |
| `reviewer_action` | Yes | Human-readable action needed before approval. |
| `rate_basis_status` | Conditional | Required when the term or result affects rate basis. |

### Line Audit Fields

| Field | Required | Contract |
|---|---:|---|
| `sct_code` | Yes | Final applied SCT code. |
| `sct_class` | Yes | SCT class of the result. |
| `document_type_code` | Conditional | Required when evidence or document terms are resolved. |
| `rate_basis_code` | Conditional | Required when rate source terms are resolved. |
| `type_b_rule_source` | Yes | One of `ACTION`, `OVERRIDE`, `FALLBACK_KEYWORD`, or `MANUAL_REVIEW`. |
| `classification_confidence` | Yes | Numeric confidence from 0.00 to 1.00. |
| `evidence_status` | Yes | One of `MATCHED_EXACT`, `PARTIAL`, `MISSING`, `CONFLICT`, or documented equivalent. |
| `gate_result` | Yes | One of `PASS`, `PASS WITH WARNINGS`, `AMBER`, `FAIL`, or `ZERO`. |
| `reviewer_action` | Yes | Specific next human review action. |

## Assumptions & Dependencies

1. Assumption: `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md` is the approved implementation brief for this spec.
2. Assumption: The GPT Action backend remains `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`.
3. Assumption: The package-level `wrangler.toml` remains valid for deployment with `main = "server/src/worker.ts"`.
4. Dependency: Before implementation, confirm whether the actual deployment source is this package or the separate `C:\Users\jichu\Downloads\HVDC Ontology Grounded` repository.
5. Dependency: GPTS preview testing must be available after deployment to verify Action behavior from the ChatGPT UI.
6. Dependency: If API key auth is enabled through `SCT_ACTION_API_KEY`, GPT Builder Action authentication must send the matching API key header.
7. Dependency: Test payloads must cover DocumentType, RateBasis, Customs Inspection override, evidence mapping, gate-check, and rate lookup.

## Success Criteria

| ID | Criteria | Measurement |
|---|---|---|
| SC-001 | BOE resolves as DocumentType. | `resolveSctOntologyTerm` returns `SCT.DOC.BOE` with confidence `>= 0.85`. |
| SC-002 | CI/PL resolves as DocumentType. | `resolveSctOntologyTerm` returns `SCT.DOC.CI_PL` with confidence `>= 0.85`. |
| SC-003 | POD resolves as DocumentType. | `resolveSctOntologyTerm` returns `SCT.DOC.POD` with confidence `>= 0.85`. |
| SC-004 | AT COST resolves as RateBasis. | Resolver returns `SCT.RATE.AT_COST`; missing support does not produce PASS. |
| SC-005 | AS PER OFFER resolves as RateBasis. | Resolver returns `SCT.RATE.AS_PER_OFFER`; missing approval does not produce PASS. |
| SC-006 | Customs Inspection override works. | `CUSTOMS INSPECTION FEE` returns TYPE-B `Inspection` in resolver and type-B classifier. |
| SC-007 | Generic Customs behavior is preserved. | `CUSTOMS CLEARANCE` and `BILL OF ENTRY FEE` remain TYPE-B `Customs`. |
| SC-008 | Evidence map returns new requirements. | Customs, Inspection, AT COST, and AS PER OFFER cases return required evidence lists. |
| SC-009 | Final subtotal gate blocks PASS. | Missing final subtotal before VAT returns `pass_allowed=false`. |
| SC-010 | Rate basis gate blocks PASS. | `MISSING` and `CONFLICT` rate basis statuses return non-PASS gate results. |
| SC-011 | Rate lookup masks private rates. | `dryRunRateLookup` response has status and `private_rate_masked=true`, with no raw rate amount. |
| SC-012 | Audit trace masks private references. | `createOntologyAuditTrace` returns masked shipment, BL, BOE, and rate references only. |
| SC-013 | OpenAPI and Worker routes align. | Every operation ID in this spec has a working route in the Worker and schema. |
| SC-014 | GPTS preview confirms Action use. | GPTS answer shows `ACTION_CALLED: YES` and `SCT_ONTOLOGY_USED: YES` for successful calls. |
| SC-015 | Regression behavior is preserved. | Existing DO, THC, STROAGE, INLAND, and generic Customs tests pass. |

## Traceability Matrix

| Scenario | Functional Requirements | Success Criteria |
|---|---|---|
| US-001 | FR-001 to FR-004, FR-023 | SC-001 to SC-003 |
| US-002 | FR-005 to FR-007, FR-018, FR-023 | SC-004, SC-005, SC-011 |
| US-003 | FR-008 to FR-010, FR-024 | SC-006, SC-007, SC-015 |
| US-004 | FR-011 to FR-014, FR-023 | SC-008 |
| US-005 | FR-015 to FR-018 | SC-009, SC-010 |
| US-006 | FR-019 to FR-022 | SC-012 to SC-014 |

## Open Questions

1. [NEEDS CLARIFICATION: Confirm whether the implementation target is this package path or `C:\Users\jichu\Downloads\HVDC Ontology Grounded`.]
2. [NEEDS CLARIFICATION: Confirm whether `SCT.DOC.CI_PL` should represent combined CI/PL only, or separate `SCT.DOC.CI` and `SCT.DOC.PL` nodes are needed later.]
3. [NEEDS CLARIFICATION: Confirm whether `BILL OF ENTRY FEE` should be represented primarily as `SCT.CHARGE.BOE_FEE`, `SCT.DOC.BOE`, or a charge-to-document relation using both.]
4. [NEEDS CLARIFICATION: Confirm whether API key authentication is required for production GPTS, or whether no-auth mode remains acceptable for internal smoke testing.]

## Clarifications Log

| Date | Item | Status |
|---|---|---|
| 2026-06-08 | Spec drafted from `SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md`. | Draft |
| 2026-06-08 | Local package route source observed as `server/src/worker.ts` from `wrangler.toml`. | Observed |
| 2026-06-08 | Separate `C:\Users\jichu\Downloads\HVDC Ontology Grounded` repository exists and may be the live deployment source. | Needs confirmation |

## Reviewer Checklist

1. Every functional requirement has a stable `FR-*` ID.
2. Every non-functional requirement has a stable `NFR-*` ID.
3. Every success criterion has a stable `SC-*` ID.
4. Every user scenario has independent testability.
5. No raw contract rates or sensitive identifiers are allowed in public output.
6. Final PASS is blocked by missing final subtotal before VAT.
7. Customs Inspection override runs before generic Customs.
8. OpenAPI operation IDs and Worker routes are synchronized.
9. GPTS preview verification is required after deployment.
10. The implementation source path is confirmed before code changes begin.

## Approval Readiness

Status: Draft, not yet Approved.

Blocking items:

1. Implementation source path must be confirmed.
2. CI/PL node granularity must be confirmed.
3. BOE Fee modeling must be confirmed.
4. Production authentication mode must be confirmed.

The spec becomes approval-ready when the four open questions are answered or explicitly accepted as implementation assumptions.

