# SWARM PLAN — ROBUST Track: SCT_ONTOLOGY Architecture Remediation Plan

**Generated**: 2026-06-14 | **Agent**: PLAN-ROBUST | **Input**: SCOUT findings (7 agents)  
**Classification**: PRIVATE_INTERNAL | **Target**: No-downtime migration to production-grade monorepo

---

## Executive Summary (3-line)

| Dimension | Current State (WHY BROKEN) | Target State | Migration Window |
|-----------|---------------------------|-------------|-----------------|
| Monorepo | 2 orphan pnpm-lock.yaml, no workspace | `pnpm-workspace.yaml` + root `tsconfig.json` bases | 1 sprint (Week 1) |
| Code Dup | MCP tools x2 (verbatim), DB pool x3 (pg, pg, psycopg2) | Single `@invoice-audit/tools` + `@invoice-audit/database` | 1 sprint (Week 2) |
| Schema Drift | TS Zod ↔ Python Pydantic manual sync | `@invoice-audit/schemas` → JSON Schema → Pydantic auto-gen | 2 sprints (Week 2-3) |
| DB Fragmentation | D1 (Wrangler), Worker-PG (Neon), MCP-PG (Neon) | Single PostgreSQL with per-tenant schema | 2 sprints (Week 3-4) |
| shpiment/domestic | JSON blobs + Python scripts outside pipeline | TypeScript contracts + CI gate via `@invoice-audit/shpiment` | 1 sprint (Week 3) |
| API Surface | No auth, no versioning, mixed error shapes | Standard REST envelope, JWT auth, `/v1/`, rate limiting | 1 sprint (Week 4) |

**Total estimated effort**: 4-5 sprints (2 team members). All phases designed for zero-downtime, side-by-side migration with rollback.

---

## 1. Monorepo Setup — pnpm Workspace + Root Configuration

### 1.1 Current State

```
SCT_ONTOLOGY-main/
├── apps/
│   ├── web/                  # Has own pnpm-lock.yaml, package.json, tsconfig.json
│   ├── mcp-server/           # Has own pnpm-lock.yaml, package.json, tsconfig.json
│   └── worker-py/            # Python, isolated (pyproject.toml)
├── packages/
│   ├── shared/               # Unused — no workspace link, no consumer imports it
│   └── contracts/            # Unused — same reason
├── wrangler.toml             # Orphaned: points to server/src/worker.ts (nonexistent)
└── (no pnpm-workspace.yaml)
```

**Problems**:
- `packages/shared` and `packages/contracts` exist but no app can `import` them because there's no workspace linking
- Two separate `pnpm-lock.yaml` files (apps/web, apps/mcp-server) drift independently
- `wrangler.toml` references `server/src/worker.ts` which does not exist
- No root `tsconfig.json` — each app has slightly different compiler options

### 1.2 Target State

```
SCT_ONTOLOGY-main/
├── pnpm-workspace.yaml       # NEW: defines workspace members
├── tsconfig.json             # NEW: root base tsconfig (extends in each package)
├── package.json              # NEW: root scripts, devDependencies
├── .npmrc                    # NEW: shamefully-hoist=false, strict-peer-dependencies
├── apps/
│   ├── web/                  # extends root tsconfig, uses workspace:*
│   ├── mcp-server/           # extends root tsconfig, uses workspace:*
│   └── worker-py/            # unchanged, Python is separate
├── packages/
│   ├── shared/               # tsconfig extends root, exports via package.json
│   ├── contracts/            # tsconfig extends root, exports via package.json
│   ├── tools/                # NEW: single source for all MCP tool implementations
│   ├── database/             # NEW: single pg Pool factory + query helpers
│   ├── schemas/              # NEW: Zod schemas → JSON Schema generation
│   └── shpiment/             # NEW: shpiment integration contracts (see §5)
└── wrangler.toml             # FIXED: points to actual entry or becomes app-specific
```

### 1.3 Migration Path

| Step | Action | Rollback |
|------|--------|----------|
| M0.1 | Create `pnpm-workspace.yaml` listing `apps/*`, `packages/*` | Delete file — apps still build independently |
| M0.2 | Create root `tsconfig.json` with strict base options | Delete file |
| M0.3 | Update each app/package `tsconfig.json` to `"extends": "../../tsconfig.json"` | Revert each file |
| M0.4 | Add root `package.json` with `scripts: { dev, build, test, typecheck, lint }` | Delete root package.json |
| M0.5 | Run `pnpm install` at root — verify single `pnpm-lock.yaml` | Revert to app-local install |
| M0.6 | Update imports: `from '../../packages/contracts'` → `from '@invoice-audit/contracts'` | Search-replace reverse |
| M0.7 | Fix or remove `wrangler.toml` (see §6.6) | Restore from git |
| M0.8 | CI: add root `pnpm typecheck`, `pnpm test` as gating checks | Remove CI step |

### 1.4 Testing Strategy

- After each step: `pnpm install && pnpm typecheck && pnpm test` at root
- Smoke test: `pnpm --filter @invoice-audit/web dev` (must start)
- Integration: Vercel preview deploy for web, local `tsx` for mcp-server
- Contract: `vitest` in packages/contracts validates `MCP_TOOL_LIST` and `SHEET_CONTRACT_V2`

### 1.5 Estimated Effort: **3 engineer-days**

---

## 2. Eliminate Code Duplication — Single Source for Tools, DB, DLP

### 2.1 Current State — Exact Duplication Found

| Duplicate | Location A | Location B | Lines |
|-----------|-----------|-----------|-------|
| `check_cost_guard` | `apps/web/src/lib/mcp/tools.ts:79-122` | `apps/mcp-server/src/tools/check_cost_guard.ts` | ~44 |
| `classify_type_b` | `apps/web/src/lib/mcp/tools.ts:52-77` | `apps/mcp-server/src/tools/classify_type_b.ts` | ~26 |
| `check_evidence_required` | `apps/web/src/lib/mcp/tools.ts:124-154` | `apps/mcp-server/src/tools/check_evidence_required.ts` | ~31 |
| `check_hs_uae_compliance` | `apps/web/src/lib/mcp/tools.ts:156-175` | `apps/mcp-server/src/tools/check_hs_uae_compliance.ts` | ~20 |
| `check_rate_card` | `apps/web/src/lib/mcp/tools.ts:177-210` | `apps/mcp-server/src/tools/check_rate_card.ts` | ~34 |
| `route_question` | `apps/web/src/lib/mcp/tools.ts:17-49` | `apps/mcp-server/src/tools/route_question.ts` | ~33 |
| `getPool()` (pg) | `apps/web/src/lib/mcp/db.ts:17-37` | `apps/mcp-server/src/db.ts:20-44` | ~25 |
| DLP patterns | `apps/web/src/lib/dlp-scanner.ts:36-125` | `apps/mcp-server/src/schemas/dlp-guard.ts` | ~90 |

**Comment in code confirms**: `apps/web/src/lib/mcp/tools.ts:4-11` explicitly states "Ported verbatim from apps/mcp-server because the repo has no workspace."

### 2.2 Target State

```
packages/tools/               # Single source for ALL 14 MCP tools
├── src/
│   ├── index.ts              # Tool registry, dispatch(), TOOLS map
│   ├── check_cost_guard.ts
│   ├── classify_type_b.ts
│   ├── check_evidence_required.ts
│   ├── check_hs_uae_compliance.ts
│   ├── check_rate_card.ts
│   ├── route_question.ts
│   ├── check_duplicate_invoice.ts
│   ├── match_shipment_reference.ts
│   ├── normalize_invoice_lines.ts
│   ├── check_contract_validity.ts
│   ├── check_tax_vat.ts
│   ├── check_fx_policy.ts
│   ├── check_dem_det.ts
│   └── build_validation_explanation.ts
├── package.json
└── tsconfig.json

packages/database/            # Single DB pool factory
├── src/
│   ├── index.ts              # getPool(), closePool(), PgPool type
│   └── test-helpers.ts       # __setPoolForTesting()
├── package.json
└── tsconfig.json

packages/dlp/                 # Single DLP scanner
├── src/
│   ├── index.ts              # scanForDlpViolations, DlpGuard, patterns
│   ├── patterns.ts           # Centralized DLP regex patterns
│   └── workbook-dlp.ts       # scanWorkbook()
├── package.json
└── tsconfig.json
```

Both `apps/web` and `apps/mcp-server` import from packages:
```typescript
import { dispatch, MCP_TOOL_NAMES } from '@invoice-audit/tools';
import { getPool } from '@invoice-audit/database';
import { scanForDlpViolations } from '@invoice-audit/dlp';
```

### 2.3 Migration Path

| Step | Action | Rollback |
|------|--------|----------|
| D1.1 | Create `packages/tools/` — move ALL 14 tool files from `apps/mcp-server/src/tools/` | Move files back |
| D1.2 | Create `packages/database/` — move `apps/mcp-server/src/db.ts` → `packages/database/src/index.ts` | Move back |
| D1.3 | Create `packages/dlp/` — merge DLP patterns from web + mcp-server | Move back |
| D1.4 | Update `apps/mcp-server/src/main.ts` — import tools from `@invoice-audit/tools` | Revert imports |
| D1.5 | DELETE `apps/web/src/lib/mcp/tools.ts` and `apps/web/src/lib/mcp/db.ts` | Restore from git |
| D1.6 | Update `apps/web/src/lib/cf-mcp-client.ts` — import dispatch from `@invoice-audit/tools` | Revert imports |
| D1.7 | Update all `__tests__` imports to point to package exports | Revert |
| D1.8 | Run full test suite: `pnpm test` | — |

### 2.4 Testing Strategy

- **Unit tests**: All existing `apps/mcp-server/src/tools/__tests__/*.test.ts` moved with tools, run via vitest in `packages/tools`
- **Integration**: `apps/web` e2e tests (Playwright) verify in-process dispatch still works
- **Contract**: MCP tool list length check (14 tools) in `packages/tools/src/index.ts`
- **Performance**: Benchmark `dispatch()` latency pre/post migration (must be <5ms delta)

### 2.5 Estimated Effort: **5 engineer-days**

---

## 3. Single Source of Truth for Data Models — Zod ↔ Pydantic Bridge

### 3.1 Current State

Two parallel schema definitions maintained manually:

| Entity | TS (Zod) | Python (Pydantic) | Drift Observed |
|--------|----------|-------------------|----------------|
| `InvoiceHeader` | `packages/contracts/invoice.schema.ts:12-19` | `apps/worker-py/app/schemas.py:11-17` | Field order, optionality |
| `InvoiceLine` | `packages/contracts/invoice.schema.ts:21-38` | `apps/worker-py/app/schemas.py:19-36` | `source_ref` type: `z.record()` vs `dict` |
| `EvidenceCandidate` | `packages/contracts/invoice.schema.ts:43-50` (inline) | `apps/worker-py/app/schemas.py:38-45` | Python has `doc_kind`, `waybill_fields` extras |
| `NormalizedInvoice` | `packages/contracts/invoice.schema.ts:41-54` | `apps/worker-py/app/schemas.py:47-54` | TS missing `doc_kind` on candidates |
| `Veridict` | `PASS\|AMBER\|ZERO\|FAILED` | Not exported as enum, scattered Literals | Inconsistent |
| Export rows (13 types) | `packages/contracts/export.schema.ts` (partial) | `apps/worker-py/app/schemas.py` (full) | TS has only 3 row schemas, Python has all 13 |

**Verdict**: The `packages/contracts` directory is dead code — 0 imports across the codebase. Python has the authoritative schemas because it's the parser worker.

### 3.2 Target State

```
packages/schemas/
├── src/
│   ├── index.ts                  # Re-exports all schemas
│   ├── invoice.ts                # InvoiceHeader, InvoiceLine, NormalizedInvoice (Zod)
│   ├── validation.ts             # ValidationFinding, McpToolCall (Zod)
│   ├── export.ts                 # All 13 workbook row schemas (Zod)
│   ├── shared.ts                 # Currency, RateBasis, Verdict enums
│   ├── generate-json-schema.ts   # Script: Zod → JSON Schema
│   └── __tests__/
│       ├── schema-contract.test.ts    # Round-trip: Zod → JSON → Pydantic → JSON → Zod
│       └── cross-language.test.ts     # Validates generated JSON Schema against Python fixtures
├── generated/
│   └── invoice-audit.schema.json  # AUTO-GENERATED JSON Schema (CI artifact)
├── package.json
└── tsconfig.json
```

**Python side**: `apps/worker-py/app/schemas.py` imports from generated JSON Schema:
```python
# Generated by pnpm run schemas:generate
from pydantic import TypeAdapter
import json, pathlib

_schema_path = pathlib.Path(__file__).parent.parent.parent.parent / "packages/schemas/generated/invoice-audit.schema.json"
_schema = json.loads(_schema_path.read_text())

NormalizedInvoice = TypeAdapter(_schema["definitions"]["NormalizedInvoice"]).validate_python
```

Or better: use `datamodel-code-generator` to auto-generate Python models from JSON Schema at build time.

### 3.3 Migration Path

| Step | Action | Rollback |
|------|--------|----------|
| S1.1 | Consolidate ALL schemas into `packages/schemas/` (canonical Zod definitions) | — |
| S1.2 | Add `zod-to-json-schema` dependency; create `generate-json-schema.ts` script | Remove script |
| S1.3 | Generate `invoice-audit.schema.json` — commit to repo as build artifact | Delete file |
| S1.4 | Add `datamodel-code-generator` to Python dev deps; run at build to generate `app/schemas_generated.py` | Revert to manual schemas |
| S1.5 | Add cross-language validation test: serialize sample data in TS → JSON → deserialize in Python → re-serialize → compare | Remove test |
| S1.6 | **Keep manual `app/schemas.py` as a second validation layer** (belt-and-suspenders) for 1 sprint, then deprecate | — |
| S1.7 | CI gate: `pnpm run schemas:check` fails if generated JSON Schema ≠ committed | Remove CI step |
| S1.8 | DELETE old `packages/contracts/` directory | Restore from git |

### 3.4 Drift Resolution — Specific Entities

| Entity | Zod (Target) | Pydantic (Current) | Resolution |
|--------|-------------|-------------------|------------|
| `EvidenceCandidate.doc_kind` | Add `doc_kind: z.string().nullable()` | Already has it | Add to Zod, keep Pydantic as-is until generated |
| `EvidenceCandidate.waybill_fields` | Add `waybill_fields: z.record(z.unknown()).nullable()` | Already has it | Add to Zod |
| `SourceDataRow` (13 export rows) | Port all 13 from Python schemas.py to Zod | Authoritative | Pydantic → Zod port, then JSON Schema generation |
| `Verdict` enum | Centralize in `packages/schemas/src/shared.ts` | Scattered | Single `VerdictSchema = z.enum(['PASS','AMBER','ZERO','FAILED'])` |
| `amount` precision | Zod: `z.number()` (unbounded) | Pydantic: `float` (unbounded) | Both → `z.number().multipleOf(0.01)` (2 decimal) |
| Migration 0008 vs 0009 drift | TEXT fields → TIMESTAMPTZ, flat → JSONB | N/A | Zod schemas should reflect 0009+ schema (JSONB) |

### 3.5 Testing Strategy

```typescript
// packages/schemas/src/__tests__/cross-language.test.ts
describe('cross-language schema fidelity', () => {
  it('round-trips NormalizedInvoice through JSON Schema', () => {
    const zodSchema = NormalizedInvoiceSchema;
    const jsonSchema = zodToJsonSchema(zodSchema);
    // Write JSON Schema to temp file
    // Spawn Python subprocess: pydantic TypeAdapter reads schema, validates fixture, re-exports
    // Compare input = output within epsilon
  });
  
  it('detects when generated JSON Schema is stale', () => {
    const committed = readFileSync('generated/invoice-audit.schema.json', 'utf-8');
    const fresh = zodToJsonSchema(NormalizedInvoiceSchema);
    expect(JSON.parse(committed)).toEqual(fresh);
  });
});
```

### 3.6 Estimated Effort: **6 engineer-days** (includes 13 export row schemas port + generator + cross-lang tests)

---

## 4. Proper Package Boundaries and Dependency Graph

### 4.1 Current State — Ad-Hoc Dependencies

```
apps/web ───(direct import)──→ packages/contracts (UNUSED — 0 imports)
apps/web ───(direct copy)────→ apps/web/src/lib/mcp/tools.ts (DUPLICATED)
apps/web ───(HTTP fetch)─────→ apps/mcp-server (via CF_MCP_BASE_URL, dev only)
apps/web ───(in-process)─────→ apps/web/src/lib/mcp/db.ts (DUPLICATED pg pool)
apps/mcp-server ──(direct)───→ apps/mcp-server/src/db.ts (OWN pg pool)
apps/worker-py ──(direct)────→ apps/worker-py/app/db.py (OWN psycopg2 pool)
apps/worker-py ──(HTTP POST)─→ apps/web/api/export/download (cross-service call)
```

No dependency graph exists. Everything is coupled by convention and copy-paste.

### 4.2 Target State — Layered Monorepo

```
┌─────────────────────────────────────────────────────────┐
│  apps/                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    web        │  │  mcp-server  │  │  worker-py   │  │
│  │  (Next.js)    │  │  (Hono/TS)   │  │  (FastAPI)   │  │
│  └──┬───┬───┬───┘  └──┬───┬───────┘  └──┬───┬───────┘  │
│     │   │   │          │   │             │   │          │
├─────┼───┼───┼──────────┼───┼─────────────┼───┼──────────┤
│  packages/                                      │          │
│  ┌────┴┐ ┌┴───────┐ ┌─┴────────┐ ┌──────┐     │          │
│  │tools│ │schemas │ │ database │ │ dlp  │     │          │
│  └─────┘ └──┬─────┘ └────┬─────┘ └──────┘     │          │
│             │             │                    │          │
│  ┌──────────┴─────────────┴────────────────────┴──────┐   │
│  │              shared (hash, redaction, utils)        │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  shpiment (TypeScript contracts for DSV shipment) │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  domestic (TypeScript contracts for domestic inv) │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Dependency rules enforced by ESLint**:
- `apps/*` → can depend on `packages/*`
- `packages/*` → can depend on `packages/shared` only (no cross-package deps except shared)
- `packages/tools` → depends on `packages/schemas`, `packages/database`
- `packages/database` → depends on `packages/shared` only
- `packages/schemas` → depends on nothing (leaf package)
- `packages/dlp` → depends on `packages/schemas` (for violation types)

### 4.3 Migration Path

| Step | Action |
|------|--------|
| B1.1 | Add `eslint-plugin-import` with `import/no-extraneous-dependencies` rules |
| B1.2 | Create `.eslintrc.workspace.js`: apps can import from `@invoice-audit/*`, packages only from `@invoice-audit/shared` |
| B1.3 | Add `depcheck` to CI: detect unused dependencies in each package |
| B1.4 | Document dependency graph in `ARCHITECTURE.md` (auto-generated by `madge`) |
| B1.5 | Add `pnpm run graph` script: generates dependency visualization |

### 4.4 Estimated Effort: **2 engineer-days**

---

## 5. shpiment/domestic Integration Contracts

### 5.1 Current State

**shpiment** (`shpiment/`):
- Standalone package with its own `PACKAGE_MANIFEST.json`, rules JSON, validation scripts
- 807 KB `private/contract_rate.json` (250 contracted rates) committed to repo — **security risk**
- Python scripts (`scripts/workbook_output_validate.py`, `scripts/harness_validate_package.py`)
- 8-sheet workbook output contract (different from main pipeline's 13-sheet contract)
- No TypeScript interface — entirely Python + JSON

**domestic** (`domestic/`):
- Standalone runtime with `ApprovedLaneMap_ENHANCED.json`, rate ledgers
- Entry point: `runtime/gpt_ci_runner.py`
- No TypeScript interface

**Problem**: Neither shpiment nor domestic have ANY integration with the main apps/web ↔ apps/mcp-server pipeline. They are separate GPT CI workflows that produce Excel outputs. The main pipeline has no awareness of shipment-level validation.

### 5.2 Target State

```
packages/shpiment/                    # TypeScript integration contracts
├── src/
│   ├── index.ts                     # Re-exports
│   ├── contract-rate.schema.ts      # Zod schema for contract_rate.json
│   ├── workbook-contract.ts         # 8-sheet output contract (different from main)
│   ├── validate.ts                  # validateShpimentWorkbook(sheets) → GateResultLite
│   ├── rule-pack.ts                 # DSV_RULEPACK_COMBINED Zod schema
│   └── __tests__/
│       ├── contract-rate.test.ts    # Validates sample against schema
│       └── workbook-contract.test.ts
├── package.json
└── tsconfig.json

packages/domestic/                   # TypeScript integration contracts
├── src/
│   ├── index.ts
│   ├── lane-map.schema.ts           # Zod schema for ApprovedLaneMap
│   ├── domestic-rate.schema.ts      # Zod schema for domestic_rate_ledger
│   ├── validate.ts                  # validateDomesticInvoice(sheets) → GateResultLite
│   └── __tests__/
├── package.json
└── tsconfig.json

apps/web/src/lib/                    # Shpiment bridge (replaces gate-bridge.ts)
├── shpiment-bridge.ts               # Calls packages/shpiment/validate
└── domestic-bridge.ts               # Calls packages/domestic/validate
```

**Shpiment data model contract** (TypeScript, generated from shpiment/private/contract_rate.json):
```typescript
// packages/shpiment/src/contract-rate.schema.ts
export const ContractRateSchema = z.object({
  charge_code: z.string(),
  lane: z.string(),
  rate_basis: z.enum(['PER_EA','PER_TRUCK','PER_TEU','PER_CBM','PER_MT','PER_DAY','AT_COST','LUMP_SUM']),
  contracted_rate: z.number(),
  currency: z.enum(['AED','USD']),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  vendor: z.string(),
  remarks: z.string().nullable()
});
export type ContractRate = z.infer<typeof ContractRateSchema>;

// Contract: MUST have exactly the columns above
export function validateRateManifest(rates: unknown[]): { valid: boolean; errors: string[] } {
  const result = z.array(ContractRateSchema).safeParse(rates);
  return { valid: result.success, errors: result.success ? [] : result.error.issues.map(i => i.message) };
}
```

### 5.3 Migration Path

| Step | Action |
|------|--------|
| SH1.1 | Create `packages/shpiment/` — extract Zod schemas from `shpiment/rules/*.json` shapes |
| SH1.2 | Create `packages/domestic/` — extract Zod schemas from `domestic/runtime/*.json` shapes |
| SH1.3 | Port `shpiment/scripts/workbook_output_validate.py` logic → `packages/shpiment/src/validate.ts` |
| SH1.4 | Wire `apps/web/src/lib/gate-bridge.ts` → call `packages/shpiment` and `packages/domestic` validators |
| SH1.5 | Add CI gate: `pnpm --filter @invoice-audit/shpiment test` runs against masked sample data |
| SH1.6 | Git-crypt or externalize `shpiment/private/contract_rate.json` (NEVER in plain repo) |
| SH1.7 | Add shpiment workbook to the main pipeline's export: option to include shipment tabs |

### 5.4 Security — Contract Rate Data

**Current risk**: 807 KB of real contracted rates committed to repo in `shpiment/private/contract_rate.json`.

**Resolution**:
1. Move to encrypted storage (Vercel Blob with server-side encryption, or KMS-encrypted S3)
2. Provide `shpiment/rules/contract_rate_PUBLIC_MASKED_SAMPLE.json` for tests only (already exists)
3. CI reads from `CONTRACT_RATE_BLOB_URL` env var (never committed)
4. Add `.gitignore` entry: `shpiment/private/contract_rate.json` + `git rm --cached`

### 5.5 Testing Strategy

- **Unit**: Validate each schema against the JSON samples in `shpiment/rules/` and `domestic/runtime/Data/`
- **Integration**: Run `workbook_output_validate.py` goldens through the TypeScript validator — must produce identical gate results
- **Contract**: CI gate: `pnpm run contracts:check` validates ALL rule JSON files against their schemas

### 5.6 Estimated Effort: **5 engineer-days**

---

## 6. Database Consolidation & Migration Strategy

### 6.1 Current State — Three Separate Databases

| Database | Location | Schema | Connection |
|----------|----------|--------|------------|
| D1 (Cloudflare) | `wrangler.toml` → `MCP_AUDIT_DB` | `migrations/0008_invoice_audit.sql` | Via Workers binding |
| Worker-PG (Neon) | `DATABASE_URL` → `apps/worker-py/app/db.py` | `migrations/0009_job_store_persist.sql` | psycopg2 `ThreadedConnectionPool` |
| Web-PG (Neon) | `DATABASE_URL` → `apps/web/src/lib/job-store-pg.ts` | `migrations/0009_job_store_persist.sql` | `pg.Pool` (Node) |
| Web-PG (MCP) | `DATABASE_URL` → `apps/web/src/lib/mcp/db.ts` | `migrations/0010_invoices.sql` | `pg.Pool` (Node) |

**Problems**:
1. `migrations/0008` (D1, 8 tables, flat TEXT columns) ≠ `migrations/0009` (PG, 6 tables, JSONB columns) — different schemas
2. `migrations/0009` **drops and recreates** tables that `0008` creates → no migration path if both execute
3. `migrations/0010_invoices.sql` adds `invoices` table with `NUMERIC(18,2)` but `fx_policies.fx_rate` uses `REAL` (0008) vs `DOUBLE PRECISION` (0009) — precision mismatch
4. `gate_results.result_json` in 0009 uses `JSONB DEFAULT '{}'` but 0008 stores `line_results TEXT` and `action_items TEXT` as separate columns
5. Three separate `DATABASE_URL` connections → each Pool is created independently with different configs

### 6.2 Target State — Single PostgreSQL with Schema Isolation

```
Single PostgreSQL instance (Neon) — one DATABASE_URL
├── public schema           # Main application tables (jobs, source_files, audit_traces, etc.)
├── shpiment schema         # Shipment-specific tables (contract_rates, dem_det_events)
├── domestic schema         # Domestic-specific tables (lane_maps, domestic_rates)
└── audit schema            # Read-only audit views (denormalized for reporting)
```

**Consolidated table design** (merging 0008 + 0009 + 0010):

```sql
-- Migration 0011: Consolidate all tables into unified schema
-- Run AFTER 0009 (PostgreSQL) — this REPLACES 0008 (D1) which should never have been run on PG

-- Core job tracking
CREATE TABLE IF NOT EXISTS public.jobs (
  job_id            TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'CREATED',
  verdict           TEXT,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_version      TEXT NOT NULL DEFAULT 'rule-0.1.0',
  parser_version    TEXT NOT NULL DEFAULT 'parser-0.1.0'
);

-- Source files (linked to jobs)
CREATE TABLE IF NOT EXISTS public.source_files (
  id                BIGSERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  file_id           TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL DEFAULT 0,
  sha256            TEXT NOT NULL,
  blob_ref          TEXT NOT NULL,
  blob_url          TEXT,
  parser_status     TEXT NOT NULL DEFAULT 'PENDING',
  uploaded_by       TEXT NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, file_id)
);

-- Audit trail (immutable, append-only)
CREATE TABLE IF NOT EXISTS public.audit_traces (
  id                BIGSERIAL PRIMARY KEY,
  trace_id          TEXT NOT NULL UNIQUE,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  step              TEXT NOT NULL,
  input_ref         TEXT NOT NULL,
  output_ref        TEXT NOT NULL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_version      TEXT,
  source_hash       TEXT,
  calculation_hash  TEXT,
  latency_ms        INTEGER,
  was_derived_from  TEXT,
  attributed_to     TEXT
);

-- Gate results (1:1 with job)
CREATE TABLE IF NOT EXISTS public.gate_results (
  id                BIGSERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE UNIQUE,
  verdict           TEXT NOT NULL,
  result_json       JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Normalized invoices (1:1 with job)
CREATE TABLE IF NOT EXISTS public.normalized_invoices (
  id                BIGSERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE UNIQUE,
  invoice_json      JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Validation results (1:1 with job)
CREATE TABLE IF NOT EXISTS public.validation_results (
  id                BIGSERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE UNIQUE,
  validation_json   JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approval records (1:1 with job)
CREATE TABLE IF NOT EXISTS public.approval_records (
  id                BIGSERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE UNIQUE,
  approval_json     JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FX policies (global, not per-job)
CREATE TABLE IF NOT EXISTS public.fx_policies (
  fx_policy_id      TEXT PRIMARY KEY,
  from_currency     TEXT NOT NULL,
  to_currency       TEXT NOT NULL,
  fx_rate           NUMERIC(18, 6) NOT NULL,  -- FIXED: consistent precision
  rate_date         DATE NOT NULL,
  valid_from        DATE NOT NULL,
  valid_to          DATE NOT NULL,
  approved_by       TEXT NOT NULL,
  proof_hash        TEXT NOT NULL
);

-- Invoices dedup table (from 0010)
CREATE TABLE IF NOT EXISTS public.invoices (
  invoice_id        TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL,
  vendor_hash       TEXT NOT NULL,
  invoice_no_hash   TEXT NOT NULL,
  amount            NUMERIC(18, 2) NOT NULL,
  currency          TEXT,
  issue_date        DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_vendor_invoice_uniq UNIQUE (vendor_hash, invoice_no_hash, amount)
);

-- Shpiment contract rates (encrypted access pattern — schema only, data from external source)
CREATE TABLE IF NOT EXISTS shpiment.contract_rates (
  id                BIGSERIAL PRIMARY KEY,
  charge_code       TEXT NOT NULL,
  lane              TEXT NOT NULL,
  rate_basis        TEXT NOT NULL,
  contracted_rate   NUMERIC(18, 4) NOT NULL,
  currency          TEXT NOT NULL,
  effective_from    DATE NOT NULL,
  effective_to      DATE,
  vendor            TEXT,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Domestic lane map
CREATE TABLE IF NOT EXISTS domestic.lane_maps (
  lane_id           TEXT PRIMARY KEY,
  from_location     TEXT NOT NULL,
  to_location       TEXT NOT NULL,
  transport_mode    TEXT NOT NULL,
  rate              NUMERIC(18, 4),
  currency          TEXT,
  valid_from        DATE,
  valid_to          DATE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_source_files_job_id ON public.source_files(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_traces_job_id ON public.audit_traces(job_id);
CREATE INDEX IF NOT EXISTS idx_fx_policies_currencies ON public.fx_policies(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_invoice ON public.invoices(vendor_hash, invoice_no_hash);
CREATE INDEX IF NOT EXISTS idx_invoices_job_id ON public.invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_contract_rates_lane ON shpiment.contract_rates(charge_code, lane);
CREATE INDEX IF NOT EXISTS idx_lane_maps_route ON domestic.lane_maps(from_location, to_location);
```

### 6.3 Precision Fix — Amount/Currency Consistency

| Column | Current Type | Target Type | Rationale |
|--------|-------------|-------------|-----------|
| `fx_policies.fx_rate` | `REAL` (0008) / `DOUBLE PRECISION` (0009) | `NUMERIC(18, 6)` | FX rates need 6 decimal places |
| `invoices.amount` | `NUMERIC(18, 2)` | `NUMERIC(18, 2)` | Invoice amounts — 2 decimal, correct |
| `contract_rates.contracted_rate` | `NUMERIC(18, 4)` | `NUMERIC(18, 4)` | Contract rates may have 4 decimals (per-unit rates) |
| `normalized_invoices.invoice_json.amount` | JSONB (unconstrained) | Validated by Zod schema: `z.number().multipleOf(0.01)` | Application-level precision |

### 6.4 Migration Strategy — Zero Downtime

**Phase 1: Create new schema (no client impact)**
1. Deploy migration `0011_unified_schema.sql` — creates tables in `public`, `shpiment`, `domestic` schemas
2. Migration uses `CREATE TABLE IF NOT EXISTS` — safe if tables already exist from 0009
3. Run `SELECT 1` smoke test from each app

**Phase 2: Dual-write period (1 sprint)**
1. Deploy `packages/database` with write-both mode: writes to BOTH old and new table structures
2. `job-store-pg.ts` updated to use `@invoice-audit/database` (single pool)
3. `apps/worker-py/app/db.py` updated to use same DATABASE_URL (different pool, same DB)
4. Verify: all writes appear in consolidated tables

**Phase 3: Cutover reads (1 sprint)**
1. Switch reads to new tables
2. Validate: all existing API responses unchanged
3. Keep old tables for 1 sprint as rollback safety net

**Phase 4: Cleanup**
1. Drop legacy tables (from 0008 D1 structure if they exist on PG)
2. Archive D1 database (export to JSON, store in Vercel Blob)
3. Remove `wrangler.toml` D1 bindings if no longer needed

### 6.5 Wrangler.toml Orphan Resolution

`wrangler.toml` references `server/src/worker.ts` which does not exist. Options:

| Option | Recommendation |
|--------|---------------|
| A) Move `apps/mcp-server` logic into a Worker | Only if ChatGPT app integration is active |
| B) Move `wrangler.toml` into `apps/mcp-server/` if that's the actual Worker | Requires restructuring |
| C) Delete `wrangler.toml` if ChatGPT app is no longer deployed | Simplest — verify with team |

**Recommended**: Option B — if the ChatGPT app is still in use, create `apps/mcp-server/wrangler.toml` with the Worker config. If not, option C.

### 6.6 Estimated Effort: **7 engineer-days**

---

## 7. API Standardization

### 7.1 Current State — Inconsistent Patterns

| Aspect | `apps/web` (Next.js) | `apps/mcp-server` (Hono) | `apps/worker-py` (FastAPI) |
|--------|---------------------|-------------------------|---------------------------|
| Error format | `{ code, message }` (string code) | `{ error: { code: -32600, message, data } }` (JSON-RPC) | `{ detail }` (FastAPI default) |
| Auth | None | None | None (CORS allow all) |
| Versioning | None | None | `/v1/export` only |
| Rate limiting | None | None | None |
| CORS | Next.js default | Hono default | `allow_origins=["*"]` |

### 7.2 Target State — Standardized API Envelope

**Error response (all services)**:
```typescript
// packages/schemas/src/api.ts
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),           // e.g. 'VALIDATION_ERROR', 'RATE_LIMITED', 'NOT_FOUND'
    message: z.string(),        // Human-readable
    details: z.array(z.object({
      field: z.string().optional(),
      reason: z.string()
    })).optional(),
    trace_id: z.string()       // For log correlation
  })
});

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z.object({
      api_version: z.literal('v1'),
      timestamp: z.string(),
      trace_id: z.string()
    })
  });
```

**Authentication**:
```typescript
// JWT-based, shared across all TypeScript services
// packages/auth/src/index.ts
import { jwtVerify } from 'jose';

export async function verifyRequest(req: Request): Promise<{ userId: string; role: string } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  // Verify against shared secret (or JWKS endpoint)
}
```

**Rate Limiting**:
- All `/api/*` routes: 200 req/min per IP (existing Wrangler ratelimit config, move to middleware)
- `/api/audit/run`: 10 req/hour per IP (expensive operation)
- Use `packages/ratelimit` with in-memory store (dev) / Upstash Redis (prod)

**API Versioning**:
- All routes under `/api/v1/*`
- Current routes get `/api/v1/*` prefix (backward compat via redirect)
- `@deprecated` header on legacy routes for 2 sprints, then remove

### 7.3 Migration Path

| Step | Action |
|------|--------|
| A1.1 | Create `packages/schemas/src/api.ts` with `ApiErrorSchema`, `ApiResponseSchema` |
| A1.2 | Create `packages/auth/src/index.ts` with JWT verification |
| A1.3 | Create `packages/ratelimit/src/index.ts` with token-bucket implementation |
| A1.4 | Add auth middleware to `apps/web` (Next.js middleware.ts) |
| A1.5 | Add auth middleware to `apps/mcp-server` (Hono middleware) |
| A1.6 | Add auth middleware to `apps/worker-py` (FastAPI dependency) |
| A1.7 | Standardize error responses in all 3 services to `ApiErrorSchema` |
| A1.8 | Add `/api/v1/*` prefix; add redirect from `/api/*` to `/api/v1/*` |
| A1.9 | CI gate: contract test validates error format consistency |

### 7.4 Testing Strategy

- **Error format**: Snapshot tests for known error codes
- **Auth**: 401 on missing token, 403 on wrong role
- **Rate limit**: 429 after exceeding threshold
- **Versioning**: `/api/audit/run` → 308 redirect to `/api/v1/audit/run`

### 7.5 Estimated Effort: **5 engineer-days**

---

## 8. Side-by-Side Migration Strategy — Zero Downtime Summary

### 8.1 Parallel Execution Phases

```
Week 1: Monorepo + Packages
  ├── M0: pnpm-workspace.yaml, root tsconfig, package.json
  ├── D1-D3: Create packages/tools, packages/database, packages/dlp
  └── B1: ESLint workspace rules

Week 2: Schema Consolidation + Dedup
  ├── S1-S4: Packages/schemas with Zod → JSON Schema generation
  ├── D4-D7: Delete duplicated code, wire up imports
  └── SH1: Create packages/shpiment schemas

Week 3: Database + Integration
  ├── DB1-DB4: Unified migration, dual-write, cutover
  ├── SH2-SH5: shpiment/domestic validators + bridge
  └── A1-A4: Auth middleware

Week 4: API Standardization + Cleanup
  ├── A5-A9: Error envelopes, versioning, rate limiting
  ├── DB5: Legacy table cleanup
  └── Full regression test suite

Week 5: Buffer + Hardening
  ├── Performance benchmarking
  ├── Load testing
  └── Documentation finalization
```

### 8.2 Rollback Strategy Per Change

| Change | Rollback Mechanism | Recovery Time |
|--------|-------------------|---------------|
| Workspace setup | Revert root package.json/tsconfig.json — apps build independently | <5 min |
| Package extraction | Revert imports + restore duplicated files from git | <15 min |
| Schema generation | Revert to manual Pydantic schemas, delete generated files | <5 min |
| DB migration | Dual-write reads old tables during cutover; drop migration is deferred by 1 sprint | <30 min |
| Auth middleware | Feature flag: `AUTH_REQUIRED=false` disables all gates | <1 min |
| API versioning | 308 redirect is additive; remove the redirect if broken | <5 min |

### 8.3 Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `pnpm workspace` breaks Next.js build | Medium | High | Test Vercel preview deploy after M0.5 |
| DB migration data loss | Low | Critical | Dual-write + backup + deferred drop |
| shpiment contract_rate.json exposure | High | High | Immediately git-crypt; rotate if leaked |
| Python deps break on schema auto-gen | Medium | Medium | Keep manual schemas.py as fallback for 1 sprint |
| Rate limiting blocks legitimate traffic | Low | Medium | `RATE_LIMIT_ENABLED=false` env flag |

---

## Appendix A: Package Map (Final State)

```
@invoice-audit/shared         → packages/shared        (hash, redaction utils)
@invoice-audit/schemas        → packages/schemas        (Zod schemas + JSON Schema gen)
@invoice-audit/tools          → packages/tools          (14 MCP validation tools)
@invoice-audit/database       → packages/database       (pg Pool factory)
@invoice-audit/dlp            → packages/dlp            (DLP scanner + patterns)
@invoice-audit/auth           → packages/auth           (JWT verification)
@invoice-audit/ratelimit      → packages/ratelimit      (Token bucket)
@invoice-audit/shpiment       → packages/shpiment       (Shipment contracts)
@invoice-audit/domestic       → packages/domestic       (Domestic contracts)
@invoice-audit/web            → apps/web                (Next.js frontend + API)
@invoice-audit/mcp-server     → apps/mcp-server         (Hono MCP JSON-RPC server)
@invoice-audit/parser         → apps/worker-py          (FastAPI PDF/XLSX parser)
```

## Appendix B: Key Files to Create/Modify

### New Files (22)

| File | Purpose |
|------|---------|
| `pnpm-workspace.yaml` | Monorepo root |
| `tsconfig.json` | Root TS config base |
| `package.json` | Root scripts |
| `.npmrc` | pnpm config |
| `packages/tools/package.json` | Tool package |
| `packages/tools/tsconfig.json` | Tool TS config |
| `packages/tools/src/index.ts` | Tool registry |
| `packages/database/package.json` | DB package |
| `packages/database/src/index.ts` | Pool factory |
| `packages/dlp/package.json` | DLP package |
| `packages/dlp/src/index.ts` | DLP scanner |
| `packages/dlp/src/patterns.ts` | Centralized patterns |
| `packages/schemas/package.json` | Schemas package |
| `packages/schemas/src/generate-json-schema.ts` | Zod → JSON Schema |
| `packages/auth/package.json` | Auth package |
| `packages/auth/src/index.ts` | JWT verify |
| `packages/ratelimit/package.json` | Rate limit package |
| `packages/ratelimit/src/index.ts` | Token bucket |
| `packages/shpiment/package.json` | Shpiment package |
| `packages/domestic/package.json` | Domestic package |
| `migrations/0011_unified_schema.sql` | Unified DB schema |
| `ARCHITECTURE.md` | Auto-gen from madge |

### Modified Files (18)

| File | Change |
|------|--------|
| `apps/web/package.json` | Add workspace deps |
| `apps/web/tsconfig.json` | Extend root |
| `apps/mcp-server/package.json` | Add workspace deps |
| `apps/mcp-server/tsconfig.json` | Extend root |
| `apps/mcp-server/src/main.ts` | Import from packages |
| `apps/web/src/lib/cf-mcp-client.ts` | Import from packages |
| `apps/web/src/lib/job-store.ts` | Use `@invoice-audit/database` |
| `apps/web/src/lib/job-store-pg.ts` | Use `@invoice-audit/database` |
| `apps/web/src/lib/gate-bridge.ts` | Wire shpiment/domestic |
| `apps/worker-py/app/schemas.py` | Import from generated JSON Schema |
| `apps/worker-py/app/db.py` | Use same DATABASE_URL |
| `apps/worker-py/app/main.py` | Add auth middleware |
| `wrangler.toml` | Fix or remove orphan reference |
| `.gitignore` | Add contract_rate.json, generated/ |
| `packages/shared/package.json` | Add remaining exports |
| `packages/contracts/` → **DELETE** | Replaced by packages/schemas |

### Deleted Files (8)

| File | Reason |
|------|--------|
| `apps/web/src/lib/mcp/tools.ts` | Duplicated — now in `@invoice-audit/tools` |
| `apps/web/src/lib/mcp/db.ts` | Duplicated — now in `@invoice-audit/database` |
| `apps/web/pnpm-lock.yaml` | Replaced by root `pnpm-lock.yaml` |
| `apps/mcp-server/pnpm-lock.yaml` | Replaced by root `pnpm-lock.yaml` |
| `packages/contracts/*` | Replaced by `packages/schemas` |
| `migrations/0008_invoice_audit.sql` | D1-only — replaced by 0011 (PG) |

---

## Appendix C: Total Effort Summary

| Section | Task | Days |
|---------|------|------|
| §1 | Monorepo setup | 3 |
| §2 | Eliminate duplication | 5 |
| §3 | Schema single source of truth | 6 |
| §4 | Package boundaries | 2 |
| §5 | shpiment/domestic contracts | 5 |
| §6 | Database consolidation | 7 |
| §7 | API standardization | 5 |
| §8 | Migration coordination + testing | 3 |
| **Total** | | **36 engineer-days** |

**Team recommendation**: 2 engineers × 4-5 sprints (2-week sprints), or 3 engineers × 3 sprints.

---

*End of ROBUST Architecture Plan. Next recommended action: Review with team, then begin Week 1 (Monorepo setup + Package extraction).*
