# SCT Ontology Improvement — Design Document

> **Date**: 2026-06-08
> **Author**: Claude (BRAINSTORM pipeline)
> **Status**: ✅ Approved (Phase 5 user sign-off)
> **Source Specs**:
> - `docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md` (24 FR, 8 NFR, 15 SC, 6 US)
> - `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md` (7 Phase, 8 Golden TC)

## 1. Goals (from SPEC.md §Goals & EXECUTION_PLAN.md §Goals)

1. Resolve BOE, CI/PL, POD, DO, STORAGE_INVOICE, etc. as `DocumentType` ontology nodes.
2. Resolve AT COST, AS PER OFFER, TARIFF, MISSING, CONFLICT as `RateBasis` nodes.
3. Force `CUSTOMS INSPECTION FEE` → TYPE-B `Inspection` (override before generic Customs).
4. Block final PASS when final subtotal before VAT, evidence status, rate basis, or Line_Audit→TYPE-B tie-out is incomplete.
5. Keep all GPT Action behavior read-only, dry-run, masked, non-mutating.

## 2. Approved Decisions (BRAINSTORM Phase 3-4)

| # | Decision | Choice | Source |
|---|----------|--------|--------|
| D-01 | Implementation target | **이 패키지 (현재 워크스페이스)** | Open Q #1 |
| D-02 | CI/PL granularity | **단일 `SCT.DOC.CI_PL`** | Open Q #2 |
| D-03 | BOE Fee modeling | **`SCT.CHARGE.BOE_FEE` (ChargeType)** | Open Q #3 |
| D-04 | Production auth | **no-auth 허용 (둘 다 병행)** | Open Q #4 |
| D-05 | Release strategy | **Option A: 단계별 배포 (Phased)** | Arch Q1 |
| D-06 | Code structure | **모듈 분리 (worker.js + lib/)** | Arch Q2 |
| D-07 | Test strategy | **curl smoke 확장 (현행 유지)** | Arch Q3 |

## 3. Architecture Overview

### 3.1 Current State (v1.0)
- `server/src/worker.ts` (721 lines): All logic inline
  - `ROUTES` mapping (9 routes)
  - `handleResolve`, `handleExplain`, `handleEvidenceMap`, `handleGateCheck`, `handleCrosswalk`, `handleAuditTrace`
  - `handleDryRunValidate`, `handleTypeBClassify`, `handleRateLookup`
  - `TYPE_B` enum, constants inline
- `openapi/hvdc_sct_ontology_actions.{noauth,apikey}.yaml` (≈990 lines each)
- `tests/curl_smoke_tests.sh` + 5 JSON payloads
- `gpts/GPT_INSTRUCTIONS_SCT_ONTOLOGY_ROUTER.md` (1.7 KB)

### 3.2 Target State (v2.0.x, phased)
```
cloudflare_worker/
├── worker.js              (routing + fetch + handler delegation only, ~400 lines)
├── lib/
│   ├── ontology-data.js   (DOC_TYPE, RATE_BASIS, CHARGE_TYPE constants/dictionaries)
│   ├── ontology.js        (resolveSctOntologyTerm: synonym matching, confidence, risk)
│   ├── type-b-classifier.js  (priority rules: OVERRIDE > KEYWORD > FALLBACK)
│   ├── evidence.js        (mapRequiredEvidence: charge→doc→rate→evidence relations)
│   ├── gate.js            (checkSctOntologyGate: subtotal/rate-basis/HS blockers)
│   └── audit.js           (createOntologyAuditTrace: masked references)
tests/
├── curl_smoke_tests.sh    (extended: 15+ cases, covers 8 Golden TC)
└── *.payload.json         (extended: 8+ new payloads for DocumentType/RateBasis/Inspection)
openapi/
├── hvdc_sct_ontology_actions.noauth.yaml  (synced with worker.js ROUTES)
└── hvdc_sct_ontology_actions.apikey.yaml  (synced)
gpts/
└── GPT_INSTRUCTIONS_SCT_ONTOLOGY_ROUTER.md  (updated: forbid final PASS on Action failure)
```

### 3.3 Module Responsibilities (single-purpose, testable)

| Module | Purpose | Public API |
|--------|---------|-----------|
| `ontology-data.js` | Static dictionaries (DOC_TYPE, RATE_BASIS, CHARGE_TYPE) | `DOC_TYPE`, `RATE_BASIS`, `CHARGE_TYPE` exports |
| `ontology.js` | Term→SCT code resolution with confidence | `resolveTerm(input)`, `explainNode(sctCode)` |
| `type-b-classifier.js` | Charge description→TYPE-B with priority | `classifyTypeB(description)`, `crosswalkSctToTypeB(sctCode)` |
| `evidence.js` | SCT code→required evidence list + status | `mapRequiredEvidence(sctCodes)`, `validateEvidence(pack)` |
| `gate.js` | Final PASS/AMBER/ZERO decision | `checkGate({subtotal, rateBasis, evidenceGaps, typeBTieOut})` |
| `audit.js` | Masked audit trace | `createOntologyAuditTrace(references)` |

Each module:
- Single responsibility
- Pure functions where possible
- No hardcoded secrets
- No request-scoped state

## 4. Phased Release Plan (7 phases, 7 deploys)

| Phase | Version | Scope | Files Changed | Rollback |
|-------|---------|-------|---------------|----------|
| 0 | (no deploy) | Baseline gap register, snapshot, Golden TC | docs only | N/A |
| 1 | v2.0.0 | Ontology seed (DocumentType 5, RateBasis 5) | `lib/ontology-data.js`, `lib/ontology.js`, 5 tests | `git revert HEAD; wrangler deploy` |
| 2 | v2.1.0 | Customs Inspection override (priority rules) | `lib/type-b-classifier.js`, 2 tests (TC-OVR-001, 002) | revert |
| 3 | v2.2.0 | Evidence map (Customs/Inspection/AT_COST/AS_PER_OFFER) | `lib/evidence.js`, 4 tests | revert |
| 4 | v2.3.0 | Gate-check blockers (subtotal, rate-basis, HS) | `lib/gate.js`, 1 test (TC-GATE-001) | revert |
| 5 | v2.4.0 | Line_Audit field mapping in worker.js | `server/src/worker.ts`, 1 test | revert |
| 6 | v2.5.0 | OpenAPI schema sync + GPT Instructions patch | `openapi/*.yaml`, `gpts/*.md` | revert |
| 7 | v2.6.0 | Full regression test + deployment report | `tests/curl_smoke_tests.sh`, docs | revert |

### 4.1 Per-Phase Acceptance Criteria

**Phase 1 (v2.0.0) — Ontology Seed**
- TC-DOC-001 (BOE) → `SCT.DOC.BOE`, confidence ≥ 0.85
- TC-DOC-002 (CI/PL) → `SCT.DOC.CI_PL`
- TC-DOC-003 (POD) → `SCT.DOC.POD`
- TC-RATE-001 (AT COST) → `SCT.RATE.AT_COST`
- TC-RATE-002 (AS PER OFFER) → `SCT.RATE.AS_PER_OFFER`
- Existing UNKNOWN fallback preserved

**Phase 2 (v2.1.0) — Customs Inspection Override**
- TC-OVR-001 (CUSTOMS INSPECTION FEE) → TYPE-B `Inspection`, rule_source=`OVERRIDE`
- TC-OVR-002 (BILL OF ENTRY FEE) → TYPE-B `Customs`, rule_source=`FALLBACK_KEYWORD`, sct_code=`SCT.CHARGE.BOE_FEE`
- Regression: DO, THC, STROAGE, INLAND unchanged

**Phase 3 (v2.2.0) — Evidence Map**
- Customs → BOE, broker invoice, CI/PL, customs approval
- Inspection → inspection approval, broker/customs invoice, BOE remark
- AT_COST → vendor/broker invoice, approval, amount match
- AS_PER_OFFER → offer approval, client approval, line amount match
- Missing BOE/CI/PL → `PARTIAL` or `MISSING`, never PASS
- Missing AT_COST support → AMBER
- Missing AS_PER_OFFER approval → AMBER

**Phase 4 (v2.3.0) — Gate Check**
- TC-GATE-001 (missing final subtotal) → `pass_allowed=false`, gate_result=`ZERO`
- Rate basis `MISSING` or `CONFLICT` → `pass_allowed=false`
- HS/UAE, DEM/DET, OOG/stowage, final recon evidence gaps → `ZERO` candidates
- AMBER reserved for incomplete-but-reviewable cases

**Phase 5 (v2.4.0) — Line_Audit Mapping**
- Output retains: `sct_code`, `sct_class`, `document_type_code`, `rate_basis_code`, `type_b_rule_source`, `classification_confidence`, `evidence_status`, `gate_result`, `reviewer_action`
- `type_b_rule_source` ∈ {`ACTION`, `OVERRIDE`, `FALLBACK_KEYWORD`, `MANUAL_REVIEW`}
- `evidence_status` ∈ {`MATCHED_EXACT`, `PARTIAL`, `MISSING`, `CONFLICT`}
- `gate_result` ∈ {`PASS`, `PASS WITH WARNINGS`, `AMBER`, `FAIL`, `ZERO`}

**Phase 6 (v2.5.0) — OpenAPI & GPTS Alignment**
- Operation IDs match SPEC §API Contract: `resolveSctOntologyTerm`, `mapRequiredEvidence`, `checkSctOntologyGate`, `crosswalkSctToTypeB`, `createOntologyAuditTrace`, `dryRunValidateInvoicePack`, `dryRunClassifyTypeB`, `dryRunRateLookup`, `explainSctOntologyNode`
- OpenAPI server URL: `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`
- Schema examples include DocumentType, RateBasis, Customs Inspection
- GPT Instructions forbid final PASS after Action failure

**Phase 7 (v2.6.0) — Regression & Deploy**
- Local: `node --check server/src/worker.ts` → 0 errors
- Live: 9/9 routes HTTP 200
- All 8 Golden TC pass
- Existing DO, Customs, STROAGE, THC, INLAND regression tests pass
- GPTS preview confirms `ACTION_CALLED: YES`, `SCT_ONTOLOGY_USED: YES`

## 5. Data Model (Phase 1 — ontology-data.js)

```javascript
// DocumentType ontology
export const DOC_TYPE = {
  BOE: { code: "SCT.DOC.BOE", label: "Bill of Entry", synonyms: ["BOE", "Bill of Entry", "Customs Declaration"], confidence: 0.92, sct_class: "DocumentType" },
  CI_PL: { code: "SCT.DOC.CI_PL", label: "Commercial Invoice & Packing List", synonyms: ["CI/PL", "CIPL", "Invoice and Packing List"], confidence: 0.90, sct_class: "DocumentType" },
  POD: { code: "SCT.DOC.POD", label: "Proof of Delivery", synonyms: ["POD", "delivery proof"], confidence: 0.88, sct_class: "DocumentType" },
  DO: { code: "SCT.DOC.DO", label: "Delivery Order", synonyms: ["DO", "Delivery Order"], confidence: 0.90, sct_class: "DocumentType" },
  STORAGE_INVOICE: { code: "SCT.DOC.STORAGE_INVOICE", label: "Storage Invoice", synonyms: ["storage invoice", "warehouse invoice"], confidence: 0.85, sct_class: "DocumentType" },
  TERMINAL_INVOICE: { code: "SCT.DOC.TERMINAL_INVOICE", label: "Terminal Invoice", synonyms: ["terminal invoice"], confidence: 0.85, sct_class: "DocumentType" },
  APPROVAL: { code: "SCT.DOC.APPROVAL", label: "Approval Evidence", synonyms: ["approval", "client approval", "offer approval"], confidence: 0.85, sct_class: "DocumentType" },
  VENDOR_INVOICE: { code: "SCT.DOC.VENDOR_INVOICE", label: "Vendor/Broker Invoice", synonyms: ["vendor invoice", "broker invoice"], confidence: 0.87, sct_class: "DocumentType" },
};

// RateBasis ontology
export const RATE_BASIS = {
  AT_COST: { code: "SCT.RATE.AT_COST", label: "At Cost", synonyms: ["AT COST", "at actuals", "as per actuals"], confidence: 0.90, sct_class: "RateBasis" },
  AS_PER_OFFER: { code: "SCT.RATE.AS_PER_OFFER", label: "As Per Offer", synonyms: ["AS PER OFFER", "per offer"], confidence: 0.88, sct_class: "RateBasis" },
  TARIFF: { code: "SCT.RATE.TARIFF", label: "Tariff", synonyms: ["TARIFF", "tariff rate"], confidence: 0.85, sct_class: "RateBasis" },
  CONTRACT_NUMERIC: { code: "SCT.RATE.CONTRACT_NUMERIC", label: "Contract Numeric", synonyms: ["contract rate"], confidence: 0.85, sct_class: "RateBasis" },
  MISSING: { code: "SCT.RATE.MISSING", label: "Missing", synonyms: [], confidence: 1.0, sct_class: "RateBasis" },
  CONFLICT: { code: "SCT.RATE.CONFLICT", label: "Conflict", synonyms: [], confidence: 1.0, sct_class: "RateBasis" },
};

// ChargeType ontology (with TYPE-B tie-out)
export const CHARGE_TYPE = {
  CUSTOMS_INSPECTION: { code: "SCT.CHARGE.CUSTOMS_INSPECTION", label: "Customs Inspection", type_b: "Inspection", priority: 1, sct_class: "ChargeType" },
  CUSTOMS_CLEARANCE: { code: "SCT.CHARGE.CUSTOMS_CLEARANCE", label: "Customs Clearance", type_b: "Customs", priority: 10, sct_class: "ChargeType" },
  BOE_FEE: { code: "SCT.CHARGE.BOE_FEE", label: "Bill of Entry Fee", type_b: "Customs", priority: 10, sct_class: "ChargeType" },
  DO: { code: "SCT.CHARGE.DO", label: "Delivery Order", type_b: "DO", priority: 10, sct_class: "ChargeType" },
  THC: { code: "SCT.CHARGE.THC", label: "Terminal Handling Charge", type_b: "THC", priority: 10, sct_class: "ChargeType" },
  INLAND: { code: "SCT.CHARGE.INLAND", label: "Inland Transport", type_b: "INLAND", priority: 10, sct_class: "ChargeType" },
  DETENTION: { code: "SCT.CHARGE.DETENTION", label: "Detention", type_b: "Detention", priority: 10, sct_class: "ChargeType" },
  STROAGE: { code: "SCT.CHARGE.STROAGE", label: "Storage", type_b: "STROAGE", priority: 10, sct_class: "ChargeType" },
  OTHERS: { code: "SCT.CHARGE.OTHERS", label: "Others", type_b: "OTHERS", priority: 99, sct_class: "ChargeType" },
};
```

## 6. Customs Inspection Override (Phase 2)

**Priority order** (highest to lowest):
1. `OVERRIDE` — Inspection keywords always beat generic Customs
2. `FALLBACK_KEYWORD` — Generic Customs/DO/THC/etc. matches
3. `FALLBACK_DEFAULT` — `OTHERS`

**Rules**:
- `CUSTOMS INSPECTION`, `CUSTOMS INSPECTION FEE`, `INSPECTION FEE` → TYPE-B `Inspection`
- `CUSTOMS CLEARANCE`, `CUSTOMS DUTY` → TYPE-B `Customs`, code `SCT.CHARGE.CUSTOMS_CLEARANCE`
- `BILL OF ENTRY`, `BOE FEE` → TYPE-B `Customs`, code `SCT.CHARGE.BOE_FEE`
- `DELIVERY ORDER` → TYPE-B `DO`
- `TERMINAL HANDLING`, `THC` → TYPE-B `THC`
- `INLAND` → TYPE-B `INLAND`
- `DETENTION`, `DEMURRAGE` → TYPE-B `Detention`
- `STORAGE`, `STROAGE` → TYPE-B `STROAGE`
- default → TYPE-B `OTHERS`

## 7. Evidence Map (Phase 3)

| SCT Code | Required Evidence | Status Rules |
|----------|-------------------|--------------|
| `SCT.CHARGE.CUSTOMS_*` | `SCT.DOC.BOE`, `SCT.DOC.VENDOR_INVOICE`, `SCT.DOC.CI_PL`, `SCT.DOC.APPROVAL` | Missing any → `PARTIAL` or `MISSING` |
| `SCT.CHARGE.CUSTOMS_INSPECTION` | `SCT.DOC.APPROVAL` (inspection), `SCT.DOC.VENDOR_INVOICE`, BOE remark if applicable | Missing → `PARTIAL` |
| `SCT.RATE.AT_COST` | `SCT.DOC.VENDOR_INVOICE`, `SCT.DOC.APPROVAL`, amount match | Missing support → `AMBER` |
| `SCT.RATE.AS_PER_OFFER` | `SCT.DOC.APPROVAL` (offer), `SCT.DOC.APPROVAL` (client), line amount match | Missing approval → `AMBER` |
| `SCT.CHARGE.DO` | `SCT.DOC.DO` | Match → `MATCHED_EXACT` |
| `SCT.CHARGE.STROAGE` | `SCT.DOC.STORAGE_INVOICE`, `SCT.DOC.TERMINAL_INVOICE` | Match → `MATCHED_EXACT` |

## 8. Gate Check (Phase 4)

**Blockers (FR-015, FR-016, FR-017)**:
- `FINAL_SUBTOTAL_MISSING` → `ZERO` (final subtotal before VAT null)
- `RATE_BASIS_MISSING` or `RATE_BASIS_CONFLICT` → `ZERO`
- `EVIDENCE_GAP_HS_UAE` → `ZERO` candidate
- `EVIDENCE_GAP_DEM_DET` → `ZERO` candidate
- `EVIDENCE_GAP_OOG_STOWAGE` → `ZERO` candidate
- `EVIDENCE_GAP_FINAL_RECON` → `ZERO` candidate

**Decision tree**:
1. Any ZERO blocker → `gate_result: ZERO`, `pass_allowed: false`
2. AMBER blockers (incomplete but reviewable) → `gate_result: AMBER`, `pass_allowed: false`
3. `type_b_tie_out: false` → `gate_result: AMBER`
4. Otherwise → `gate_result: PASS`, `pass_allowed: true`

**AMBER allowed for**: incomplete support that is reviewable but not approval-ready.

## 9. Line_Audit Field Mapping (Phase 5)

Worker `handleResolve` output must include:
```json
{
  "input": "CUSTOMS INSPECTION FEE",
  "sct_code": "SCT.CHARGE.CUSTOMS_INSPECTION",
  "sct_class": "ChargeType",
  "document_type_code": null,
  "rate_basis_code": null,
  "type_b": "Inspection",
  "type_b_rule_source": "OVERRIDE",
  "classification_confidence": 0.95,
  "evidence_status": "MATCHED_EXACT",
  "gate_result": "AMBER",
  "risk": "HIGH",
  "reviewer_action": "Verify inspection approval document before approval",
  "rate_basis_status": null
}
```

## 10. OpenAPI & GPTS Alignment (Phase 6)

Operation IDs (must match in worker.js, OpenAPI, GPT Builder):
- `resolveSctOntologyTerm` → POST `/ontology/resolve`
- `explainSctOntologyNode` → POST `/ontology/explain`
- `mapRequiredEvidence` → POST `/ontology/evidence-map`
- `checkSctOntologyGate` → POST `/ontology/gate-check`
- `crosswalkSctToTypeB` → POST `/ontology/crosswalk`
- `createOntologyAuditTrace` → POST `/ontology/audit-trace`
- `dryRunValidateInvoicePack` → POST `/dry-run/validate`
- `dryRunClassifyTypeB` → POST `/dry-run/type-b-classify`
- `dryRunRateLookup` → POST `/dry-run/rate-lookup`

GPT Instructions patch:
- Forbid final PASS if Action call fails
- Forbid `SCT_ONTOLOGY_USED: YES` on 404/500
- Allow Knowledge fallback only for AMBER/ZERO analysis (not PASS)

## 11. Test Plan (curl smoke)

```bash
# Phase 1
curl -X POST $BASE/ontology/resolve -d @tests/resolve-boe.payload.json
curl -X POST $BASE/ontology/resolve -d @tests/resolve-cipl.payload.json
curl -X POST $BASE/ontology/resolve -d @tests/resolve-pod.payload.json
curl -X POST $BASE/ontology/resolve -d @tests/resolve-at-cost.payload.json
curl -X POST $BASE/ontology/resolve -d @tests/resolve-as-per-offer.payload.json

# Phase 2
curl -X POST $BASE/dry-run/type-b-classify -d @tests/classify-inspection-fee.payload.json
curl -X POST $BASE/dry-run/type-b-classify -d @tests/classify-boe-fee.payload.json

# Phase 3
curl -X POST $BASE/ontology/evidence-map -d @tests/evidence-customs.payload.json
curl -X POST $BASE/ontology/evidence-map -d @tests/evidence-inspection.payload.json
curl -X POST $BASE/ontology/evidence-map -d @tests/evidence-at-cost.payload.json
curl -X POST $BASE/ontology/evidence-map -d @tests/evidence-as-per-offer.payload.json

# Phase 4
curl -X POST $BASE/ontology/gate-check -d @tests/gate-missing-subtotal.payload.json
```

**Coverage**: 8 Golden TC + 5 regression tests for DO/THC/STROAGE/INLAND/기존 Customs.

## 12. Risk & Mitigation

| Risk | Mitigation | Rollback |
|------|-----------|----------|
| Phase 1 ontology changes break existing resolve | Only ADD new synonyms, preserve existing | `git revert HEAD; wrangler deploy` |
| Phase 2 override priority order wrong | 2 dedicated TC (TC-OVR-001, 002) | Revert v2.1.0 |
| Phase 4 gate blocks existing PASS cases | Baseline gap analysis before Phase 4 | Revert v2.3.0 |
| OpenAPI drift from worker.js | Generate both from shared `ROUTES` source-of-truth | Sync revert |
| Raw rate/shipment ID leaks | Audit review of all response fields (NFR-003) | Revert + rotate |

## 13. Success Criteria (mapped to SPEC §SC-001~015)

| SC | Test | Phase |
|----|------|-------|
| SC-001 (BOE) | TC-DOC-001 | 1 |
| SC-002 (CI/PL) | TC-DOC-002 | 1 |
| SC-003 (POD) | TC-DOC-003 | 1 |
| SC-004 (AT_COST) | TC-RATE-001 | 1 |
| SC-005 (AS_PER_OFFER) | TC-RATE-002 | 1 |
| SC-006 (Inspection override) | TC-OVR-001 | 2 |
| SC-007 (Customs preserved) | TC-OVR-002 + regression | 2 |
| SC-008 (Evidence map) | 4 evidence tests | 3 |
| SC-009 (Subtotal blocker) | TC-GATE-001 | 4 |
| SC-010 (Rate basis blocker) | TC-GATE-001 variant | 4 |
| SC-011 (Rate lookup masked) | Phase 6 review | 6 |
| SC-012 (Audit trace masked) | Phase 6 review | 6 |
| SC-013 (OpenAPI sync) | Phase 6 review | 6 |
| SC-014 (GPTS preview) | Phase 7 | 7 |
| SC-015 (No regression) | Phase 7 | 7 |

## 14. Out of Scope (from EXECUTION_PLAN §Scope)

1. Raw contract rate disclosure
2. Raw BL/BOE/TRN/container/shipment/person/email/approval text in public payload
3. ERP/TMS/WMS/payment/invoice approval execution
4. Reclassifying true Customs Clearance/Duty/BOE Fee as Inspection
5. Final PASS when final subtotal before VAT is missing

## 15. Definition of Done (mapped to EXECUTION_PLAN §DoD)

1. BOE, CI/PL, POD resolve as DocumentType ✓ (Phase 1)
2. AT COST, AS PER OFFER resolve as RateBasis ✓ (Phase 1)
3. CUSTOMS INSPECTION FEE → TYPE-B `Inspection` ✓ (Phase 2)
4. BILL OF ENTRY FEE → TYPE-B `Customs` + BOE evidence ✓ (Phase 2-3)
5. Line_Audit retains all 9 required fields ✓ (Phase 5)
6. Final subtotal missing blocks final PASS ✓ (Phase 4)
7. ROUNDUP(2) disclosure preserved (N/A for this scope)
8. Regression tests pass for DO/Customs/STROAGE/THC/INLAND ✓ (Phase 7)

## 16. References

- `docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md` (input spec, 282 lines)
- `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md` (input plan, 317 lines)
- `docs/ROUTE_DECISION.md` (existing route decision)
- `gpts/GPT_INSTRUCTIONS_SCT_ONTOLOGY_ROUTER.md` (current GPT instructions)
- `README_INSTALL.md` (deploy guide)
- `~/.claude/CLAUDE.md` (global SCM domain rules)
- `~/.claude/rules/golden-principles.md` (12 principles)

---

**Status**: ✅ Phase 5 user-approved. Ready for Phase 7 self-review.
