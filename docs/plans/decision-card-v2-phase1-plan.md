# Plan: Decision Card v2 — Phase 1 Backend Contract

Branch: `claude/romantic-faraday-e63c2a`
Source Spec: `decision-card-v2.Spec.md` (v0.1.0, In Review)
Source Method Doc: `plan_Decision Card v2.md`
Created: 2026-05-17
Status: Phase 1 (approved via /auto invocation)

---

## Phase 1 Approval Marker

- [x] Phase 1 — Backend contract scope confirmed via `/auto`

Reason: Spec assumption A1 (React/Next.js) does not match this repo (Cloudflare Worker MCP + vanilla HTML widget at `public/hvdc-answer-widget.html`). The most valuable, repo-safe slice is the **data + rule + adapter contract** that any future UI (vanilla widget update or future SPA) can consume.

This plan is co-located with other planning docs in `docs/plans/` to preserve the existing root `plan.md` (Phase 2 Validation Signal Merge, 2026-05-11).

---

## 1. Goal

Implement the Decision Card v2 **backend contract** (schema, fail-safe rule engine, adapter from existing `GroundedAnswer`) so any UI can render verdict / BLOCK reason / unblock inputs / evidence coverage / actions / trace without re-deriving rules client-side.

In scope:
- `DecisionCardPayload` TypeScript types (FR-001..FR-006, FR-020..FR-025)
- `deriveVerdict()` with fail-safe BLOCK precedence (FR-007, FR-008, FR-009, FR-030, AC-011)
- Minimum Rule Matrix lookup (Spec §"Minimum Rule Matrix": SCT-COST-001, SCT-DOC-002, SCT-PII-003, SCT-P2-004, SCT-APP-005, SCT-CONF-006, SCT-SCHEMA-007)
- `derivePiiStatus()` (FR-008, AC-005)
- `buildEvidenceCoverage()` per-domain rollup (FR-020)
- `buildBlockedActions()` for `BLOCK` / `PII: Risk` / approval-pending (FR-017, AC-005, AC-006)
- `toDecisionCardPayload(answer: GroundedAnswer, opts?)` adapter — pure function, no I/O, no side effects
- Vitest unit tests covering P0 rules and AC-001..AC-008, AC-011, AC-012

Out of scope (separate phases):
- UI components / vanilla widget update (Phase 2)
- Approval workflow persistence in D1 / KV (Phase 3)
- Analytics event emission (Phase 4)
- React/Next.js SPA (NG1 in Spec; not applicable to this repo)
- Existing `Verdict` / `GroundedAnswer` type modifications (Phase 1 is additive only)

---

## 2. Implementation

### 2.1 File Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `server/src/decision-card.ts` | **create** | Types, derive functions, rule matrix, adapter |
| 2 | `tests/decision-card.test.ts` | **create** | Unit tests for derive + adapter |
| 3 | `server/src/types.ts` | **edit** (re-export block at bottom) | Surface `DecisionCardPayload` types alongside other module re-exports |

No changes to `answer.ts`, `worker.ts`, `hvdc-server.ts`, or the widget in Phase 1 — adapter is opt-in / consumer-driven.

### 2.2 Module API (`server/src/decision-card.ts`)

```ts
// --- Enums (Spec §"Enum Definitions") ---
export type CardVerdict = "PASS" | "WARN" | "BLOCK";
export type PiiStatus = "None" | "Masked" | "Risk";
export type EvidenceDomainStatus = "PASS" | "WARN" | "BLOCK";
export type ApprovalStatus =
  | "NotRequired" | "Pending" | "Approved" | "Rejected" | "Expired";
export type ActionStatus =
  | "Open" | "Pending Input" | "Pending Approval"
  | "Done" | "Rejected" | "Expired" | "Unassigned";
export type DataClass = "P0" | "P1" | "P2";
export type ExportType = "Copy JSON" | "Export PDF Draft" | "Publish Report";

// --- Rule matrix entry ---
export type DecisionRule = {
  ruleId: string;          // e.g. "SCT-COST-001"
  ruleName: string;
  reason: string;
  requiredInputs: readonly string[];
  blockedActions: readonly string[];
  severity: "P0" | "P1" | "P2";
};

// Static, reviewer-controlled
export const RULE_MATRIX: Readonly<Record<string, DecisionRule>>;
// Mapping: legacy ValidationFinding.reasonCode → ruleId in RULE_MATRIX
export const REASON_CODE_TO_RULE: Readonly<Record<string, string>>;

// --- Output types (Spec §"DecisionCardPayload Contract") ---
export type BlockedByEntry = {
  ruleId: string;
  ruleName: string;
  reason: string;
  requiredInputs: string[];
  missingInputs: string[];
  severity: "P0" | "P1" | "P2";
};

export type EvidenceCoverageItem = {
  domain: string;
  status: EvidenceDomainStatus;
  required: number;
  available: number;
};

export type ActionItem = {
  actionId: string;
  ownerRole: string;
  ownerNameMasked: string | null;
  actionType: string;
  actionLabel: string;
  requiredInput: string | null;
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  status: ActionStatus;
  evidenceIds: string[];
  blockedUntil: string[];
  dueAt: string | null;
};

export type DecisionCardTrace = {
  sourceHash: string;
  rulePackVersion: string;
  promptVersion: string;
  approvalActor: string | null;
  approvalStatus: ApprovalStatus;
  sensitiveAccessed: boolean;
  generatedAt: string;
  routeId: string;
};

export type DecisionCardPayload = {
  cardId: string;
  routeId: string;
  generatedAt: string;
  verdict: CardVerdict;
  severity: "P0" | "P1" | "P2";
  primaryReason: string;
  unblockSummary: string;
  piiStatus: PiiStatus;
  dataClass: DataClass;
  blockedBy: BlockedByEntry[];
  allowedActions: string[];
  blockedActions: string[];
  evidenceCoverage: EvidenceCoverageItem[];
  actions: ActionItem[];
  trace: DecisionCardTrace;
};

// --- Pure derivation functions ---
export function deriveVerdict(input: {
  missingRequiredInputs: readonly string[];
  piiStatus: PiiStatus;
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  lowConfidenceHighRisk: boolean;
  hasBlockingFindings: boolean;
  hasWarningFindings: boolean;
}): CardVerdict;

export function derivePiiStatus(args: {
  piiMasked: boolean;
  hasRawPiiMarkers: boolean;
}): PiiStatus;

export function buildEvidenceCoverage(args: {
  evidence: ReadonlyArray<{ id: string; docId: string }>;
  requiredDocs: readonly string[];
}): EvidenceCoverageItem[];

export function buildBlockedActions(args: {
  verdict: CardVerdict;
  piiStatus: PiiStatus;
  approvalStatus: ApprovalStatus;
  approvalRequired: boolean;
  baseBlockedActions: readonly string[];
}): string[];

// --- Adapter ---
export function toDecisionCardPayload(args: {
  answer: GroundedAnswer;
  approvalState?: {
    required: boolean;
    status: ApprovalStatus;
    actor?: string | null;
  };
  rulePackVersion?: string;
  promptVersion?: string;
  dataClass?: DataClass;
  cardId?: string;
}): DecisionCardPayload;
```

### 2.3 Fail-Safe BLOCK Precedence (FR-030, AC-011)

`deriveVerdict` evaluation order (first match wins):
1. `piiStatus === "Risk"` → `BLOCK`
2. `missingRequiredInputs.length > 0` → `BLOCK`
3. `approvalRequired && approvalStatus !== "Approved"` → `BLOCK`
4. `lowConfidenceHighRisk` → `BLOCK`
5. `hasBlockingFindings` → `BLOCK`
6. `hasWarningFindings` → `WARN`
7. else → `PASS`

This guarantees: if upstream emits `verdict: "PASS"` but `blockedBy[]` is non-empty, adapter overrides to `BLOCK` (AC-011).

### 2.4 Rule Matrix (Spec §"Minimum Rule Matrix")

| Rule ID | Required Inputs | Blocked Actions | Severity |
|---|---|---|---|
| SCT-COST-001 | InvoiceLine, RateRef, TariffRef | Cost judgment, Invoice approval | P0 |
| SCT-DOC-002 | BOE, DO, Port evidence | Report publication | P0 |
| SCT-PII-003 | Redaction proof | Export, Publish, External share | P0 |
| SCT-P2-004 | Material ID, redacted snippet, sourceHash | Export, Publish | P0 |
| SCT-APP-005 | Approval actor/status | Invoice approval, Publish, External send | P0 |
| SCT-CONF-006 | Manual review or stronger evidence | Cost judgment, Publish | P1 |
| SCT-SCHEMA-007 | Valid DecisionCardPayload | All high-risk actions | P0 |

Mapping (`REASON_CODE_TO_RULE`):
- `SCT_COST_EVIDENCE_REQUIRED` → `SCT-COST-001`
- `SCT_CUSTOMS_EVIDENCE_REQUIRED` → `SCT-DOC-002`
- `PII_MASKED` (with `piiMasked === false`) → `SCT-PII-003`
- `HUMAN_GATE_REQUIRED` → `SCT-APP-005`
- `INSUFFICIENT_EVIDENCE` / `MISSING_REQUIRED_DOC` / `MISSING_MASTER_EVIDENCE` → `SCT-SCHEMA-007`
- unknown / unmapped → `SCT-SCHEMA-007` (fail-safe)

### 2.5 Adapter Logic (`toDecisionCardPayload`)

1. Map `answer.validation` (`ValidationFinding[]`, severity=BLOCK only) → `blockedBy[]` using `REASON_CODE_TO_RULE` + `RULE_MATRIX`
2. Compute `missingRequiredInputs` = dedup union of `rule.requiredInputs` across all BLOCK findings' mapped rules
3. `piiStatus` = `derivePiiStatus({ piiMasked: answer.piiMasked, hasRawPiiMarkers: false })` (Phase 1: trust upstream redactor; P2 raw marker hook in Phase 3)
4. `approvalRequired` = any (`answer.actions[].humanGateRequired || answer.validation[].reasonCode === "HUMAN_GATE_REQUIRED"`) OR explicit `args.approvalState?.required`
5. `approvalStatus` = `args.approvalState?.status ?? "NotRequired"`
6. `verdict` = `deriveVerdict(...)` — overrides `answer.verdict` per fail-safe rule (also normalizes `INFO`/`NO_EVIDENCE` away)
7. `severity` = highest severity among `blockedBy[]` (default `P1` if none)
8. `primaryReason` = first BLOCK finding's `message`, truncated to 80 chars with `…` ellipsis (FR-003, EC12)
9. `unblockSummary` = first 5 of `missingRequiredInputs`, joined with `, `, with ` +N more` suffix if overflow (FR-004, EC7)
10. `evidenceCoverage` = `buildEvidenceCoverage(...)` from `answer.evidence` + `answer.route.requiredDocs`
11. `allowedActions` / `blockedActions` = derived from `buildBlockedActions(...)` + base set
12. `actions[]` = map `answer.actions` → `ActionItem` with default `status: "Open"`, `dueAt: action.dueAt ?? null`
13. `trace` = `{ sourceHash: deterministic from evidence docHashes, rulePackVersion: args.rulePackVersion ?? "2026.05", promptVersion: args.promptVersion ?? "unknown", approvalActor: args.approvalState?.actor ?? null, approvalStatus, sensitiveAccessed: piiStatus !== "None", generatedAt: answer.generatedAt, routeId: answer.route.routeId }`
14. `cardId` = `args.cardId ?? "DC-" + answer.answerId` (deterministic, no `Date.now()`)
15. `dataClass` = `args.dataClass ?? "P1"` (default)

### 2.6 PII / P2 Safety Invariants

Adapter MUST NOT:
- Inline raw evidence `snippet` text into `primaryReason`, `unblockSummary`, or any top-level header field (use static rule.reason instead)
- Include `evidence[].snippet` directly in `DecisionCardPayload` — Phase 1 omits a raw evidence array entirely; only `evidenceCoverage` counts are exposed

These invariants are explicitly tested in `decision-card.test.ts` (FR-014, FR-015, NFR-003).

---

## 3. Test Plan (TDD)

File: `tests/decision-card.test.ts`

### 3.1 `deriveVerdict` (RED → GREEN)
1. PASS path: no missing inputs, no PII risk, no approval, no findings → `"PASS"`
2. AC-011 fail-safe: hasBlockingFindings → `"BLOCK"` even if `missingRequiredInputs` empty
3. FR-008: piiStatus `"Risk"` → `"BLOCK"`
4. FR-007: `missingRequiredInputs` non-empty → `"BLOCK"`
5. FR-009: `approvalRequired` + `"Pending"` → `"BLOCK"`
6. `lowConfidenceHighRisk` → `"BLOCK"`
7. WARN: `hasWarningFindings` only → `"WARN"`
8. Precedence: piiStatus `"Risk"` wins even if only warnings present

### 3.2 `derivePiiStatus`
1. `piiMasked=true`, no raw markers → `"Masked"`
2. `piiMasked=false`, no raw markers → `"None"`
3. `hasRawPiiMarkers=true` → `"Risk"` (overrides `piiMasked`)

### 3.3 `buildEvidenceCoverage`
1. All `requiredDocs` present in evidence → all rows PASS
2. One `requiredDoc` missing → that domain BLOCK, others PASS
3. Empty evidence + non-empty `requiredDocs` → all BLOCK

### 3.4 `buildBlockedActions`
1. PASS + Masked + NotRequired → empty
2. `piiStatus="Risk"` → includes `"Export"`, `"Publish"`, `"External Send"`
3. `approvalRequired` + `"Pending"` → includes `"Invoice approval"`, `"Publish Report"`
4. BLOCK + base blocked actions → union, deduped

### 3.5 `toDecisionCardPayload` adapter
1. AC-001: BLOCK input → output has `verdict="BLOCK"`, `primaryReason.length ≤ 80`, non-empty `unblockSummary`
2. AC-002: `blockedBy[0]` has `ruleId`, `ruleName`, `reason`, `requiredInputs.length > 0`, `blockedActions.length > 0`
3. AC-005: input with `piiMasked=false` + PII finding → `blockedActions` contains `"Export"` and `"Publish"`
4. AC-007: each action has `ownerRole`, `actionType`, defaults `status="Open"`
5. AC-008: trace has `generatedAt`, `sourceHash`, `rulePackVersion`, `approvalStatus`, `routeId`
6. AC-011: input with `verdict="PASS"` but validation has BLOCK finding → output `verdict="BLOCK"`
7. EC7: 7 missing inputs → `unblockSummary` shows first 5 + `" +2 more"` suffix
8. EC12: 200-char rule message → `primaryReason` truncated to 80 chars (with `…`)
9. NFR-003 invariant: `JSON.stringify(payload)` does NOT contain any raw evidence `snippet` text from input
10. Determinism: same input → same output (no `Date.now()` calls)

### 3.6 Rule Matrix lookup
1. Each known `ReasonCode` in `REASON_CODE_TO_RULE` resolves to a `RULE_MATRIX` entry
2. Unknown reasonCode → fallback to `SCT-SCHEMA-007`

Target: **24+ tests**, all passing.

---

## 4. Verification Gate

```bash
npm run typecheck                                    # TS strict
npx vitest run tests/decision-card.test.ts           # focused new tests
npm test                                             # full suite — no regression
```

Evidence threshold: 100% of new tests pass + 0 TS errors + existing test suite unchanged.

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Existing `Verdict` type (`PASS/WARN/BLOCK/INFO/NO_EVIDENCE`) collides with new `CardVerdict` | Use distinct `CardVerdict` type; adapter normalizes `INFO/NO_EVIDENCE` → `BLOCK` (fail-safe) |
| `worker-assets` generation step required before `tsc` | `npm run typecheck` chains `generate:worker-assets`; new module has no asset dependency |
| Future consumer bypasses adapter and calls `deriveVerdict` directly with bad input | Document adapter as the single supported entry point; `deriveVerdict` is exported for testability |
| Rule reason text might leak P2 content | Rule matrix entries are static, reviewer-controlled strings — no dynamic interpolation |
| Adapter accidentally embeds raw evidence text | Explicit `JSON.stringify` regression test (3.5 #9) |

---

## 6. Out-of-Scope Acknowledgment

The following Spec items are intentionally deferred and NOT in Phase 1:
- FR-011/012/013 (Drawer interaction) — UI phase
- FR-016 (HumanGateBanner UI) — UI phase
- FR-018 (Approval UI flow) — Phase 3
- FR-019 (persist approval trace in D1/KV) — Phase 3
- FR-027/028 (Export PDF, Publish Report buttons) — UI + Phase 3
- FR-029 (Traceability bundle artifacts) — release tooling phase
- NFR-001 perf, NFR-009 analytics — Phase 4

Adapter output is **shape-compatible** with these future phases so they can be added without re-keying the contract.
