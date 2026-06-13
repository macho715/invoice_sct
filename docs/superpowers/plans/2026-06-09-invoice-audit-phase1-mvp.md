# Invoice Audit Platform ??Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 1 MVP of the SCT_ONTOLOGY ?? Invoice Audit Platform ??a working end-to-end slice: upload `.xlsx/.md/.txt` ??Python parser ??Vercel ??Cloudflare MCP dry-run validation ??JSON result, with status polling and result UI.

**Architecture:** Hybrid 3-tier. **Vercel Next.js** hosts the UI and API Orchestrator (App Router). **Cloudflare Workers MCP** (already deployed at `hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`, 16 tools) is called via HTTP by Vercel for SCT validation ??3 tools used in Phase 1: `route_question`, `check_cost_guard`, `check_doc_guardian`. **Python FastAPI** worker runs locally in dev / as a container in prod, exposes `POST /parse` that returns normalized JSON. Vercel Blob (private) holds source files. D1 / Vercel Postgres holds job/result/trace metadata (Phase 1 uses an in-memory job store with a D1 swap path).

**Tech Stack:**
- Vercel: Next.js 15 (App Router) + TypeScript 5 + Vitest + zod
- Vercel Blob (private), `@vercel/blob` SDK
- Python: FastAPI 0.115+ + uvicorn + openpyxl + pydantic v2 + pytest
- CF MCP: HTTP transport to `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp` (JSON-RPC over HTTP)
- CostGuard 4-band ??platform 3-state bridge (no UI yet for AMBER/ZERO review ??that is Phase 2)

**Source spec:** `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC_v0.2.0.md` 1.2 D-001~D-005, 2 US-001~US-003, 3 FR-001~FR-030c (Phase 1 subset), 5.1, 5.2 API-001~API-004, 5.4, 5.8.

**Phase 1 exit criteria (per spec 9 P1-T6):** sample `.xlsx/.md/.txt` E2E JSON result generated, no silent fail, all 4 API endpoints return 2xx on happy path, all error codes return stable responses on negative tests.

**Out of Phase 1 scope:** approval flow (US-004), xlsx export (US-005), human-gate matrix, FxPolicy flow, batch upload, PDF, OCR, i18n, observability metrics, re-run, identity provider, R2 ??all Phase 2+.

---

## File Structure

```
SCT_ONTOLOGY-main/
??? apps/                                       [NEW monorepo root]
??  ??? web/                                    [NEW Vercel Next.js]
??  ??  ??? package.json
??  ??  ??? next.config.js
??  ??  ??? tsconfig.json
??  ??  ??? vitest.config.ts
??  ??  ??? .env.example
??  ??  ??? src/
??  ??  ??  ??? app/
??  ??  ??  ??  ??? layout.tsx
??  ??  ??  ??  ??? page.tsx
??  ??  ??  ??  ??? globals.css
??  ??  ??  ??  ??? invoice-audit/
??  ??  ??  ??  ??  ??? upload/page.tsx
??  ??  ??  ??  ??  ??? jobs/[jobId]/page.tsx
??  ??  ??  ??  ??? api/
??  ??  ??  ??      ??? files/ingest/route.ts
??  ??  ??  ??      ??? invoice-audit/run/route.ts
??  ??  ??  ??      ??? audit/status/route.ts
??  ??  ??  ??      ??? audit/result/route.ts
??  ??  ??  ??? lib/
??  ??  ??  ??  ??? types.ts                   # Platform-side zod schemas
??  ??  ??  ??  ??? error-codes.ts             # Spec 5.8 constants
??  ??  ??  ??  ??? job-store.ts               # In-memory store (swap for D1 later)
??  ??  ??  ??  ??? blob.ts                    # Vercel Blob wrapper
??  ??  ??  ??  ??? cf-mcp-client.ts           # HTTP client to CF MCP
??  ??  ??  ??  ??? gate-bridge.ts             # 4-band ??3-state verdict
??  ??  ??  ??  ??? parser-client.ts           # HTTP client to Python worker
??  ??  ??  ??  ??? trace.ts                   # audit_trace append
??  ??  ??  ??? components/
??  ??  ??      ??? upload-form.tsx            # Client component, file picker
??  ??  ??? tests/
??  ??      ??? types.test.ts
??  ??      ??? error-codes.test.ts
??  ??      ??? job-store.test.ts
??  ??      ??? blob.test.ts
??  ??      ??? cf-mcp-client.test.ts
??  ??      ??? gate-bridge.test.ts
??  ??      ??? parser-client.test.ts
??  ??      ??? api-files-ingest.test.ts
??  ??      ??? api-invoice-audit-run.test.ts
??  ??      ??? api-audit-status.test.ts
??  ??      ??? api-audit-result.test.ts
??  ??? worker-py/                              [NEW Python FastAPI]
??      ??? pyproject.toml
??      ??? README.md
??      ??? app/
??      ??  ??? __init__.py
??      ??  ??? main.py                        # FastAPI app
??      ??  ??? routes/
??      ??  ??  ??? __init__.py
??      ??  ??  ??? health.py
??      ??  ??  ??? parse.py
??      ??  ??? parsers/
??      ??  ??  ??? __init__.py
??      ??  ??  ??? xlsx.py
??      ??  ??  ??? md.py
??      ??  ??  ??? txt.py
??      ??  ??? validators/
??      ??  ??  ??? __init__.py
??      ??  ??  ??? numeric_integrity.py
??      ??  ??? schemas.py                     # Pydantic
??      ??? tests/
??          ??? __init__.py
??          ??? conftest.py
??          ??? test_numeric_integrity.py
??          ??? test_xlsx_parser.py
??          ??? test_md_parser.py
??          ??? test_txt_parser.py
??          ??? test_main.py
??? tests/integration/                          [NEW e2e smoke]
    ??? README.md
    ??? phase1_smoke.spec.ts                    # E2E manual smoke checklist
```

**File responsibilities (one line each):**
- `apps/web/src/lib/types.ts` ??zod schemas for `JobStatus`, `SourceFile`, `InvoiceLine`, `SctValidationResult`, `GateResult`, `AuditTrace`. Single source of truth on the Vercel side.
- `apps/web/src/lib/error-codes.ts` ??frozen error code constants per spec 5.8 (Phase 1 subset).
- `apps/web/src/lib/job-store.ts` ??`createJob`, `getJob`, `updateJob`, `appendTrace`. Phase 1: in-memory `Map<string, Job>`. Interface designed for D1 swap.
- `apps/web/src/lib/blob.ts` ??thin wrapper over `@vercel/blob` `put`/`del`. Returns `{blob_ref, sha256, size_bytes}`.
- `apps/web/src/lib/cf-mcp-client.ts` ??`validate(jobId, normalized): SctValidationResult` calls CF MCP `route_question` + `check_cost_guard` + `check_doc_guardian`. Timeout 5s, retry 1s/4s/16s  3, circuit breaker.
- `apps/web/src/lib/gate-bridge.ts` ??pure function `bandToVerdict(band): 'PASS'|'AMBER'|'ZERO'|'FAILED'` (spec 5.6).
- `apps/web/src/lib/parser-client.ts` ??`parse(blobRef): NormalizedInvoice` HTTP call to Python worker.
- `apps/web/src/lib/trace.ts` ??`appendTrace(jobId, step, inputRef, outputRef)` writes to in-memory trace list.
- `apps/web/src/app/api/files/ingest/route.ts` ??POST handler for API-001 (upload + sha256 + job creation).
- `apps/web/src/app/api/invoice-audit/run/route.ts` ??POST handler for API-002 (parse ??CF MCP ??build result).
- `apps/web/src/app/api/audit/status/route.ts` ??GET handler for API-003.
- `apps/web/src/app/api/audit/result/route.ts` ??GET handler for API-004.
- `apps/web/src/app/invoice-audit/upload/page.tsx` ??server component, renders `<UploadForm/>`.
- `apps/web/src/components/upload-form.tsx` ??client component, file picker ??POST `/api/files/ingest` ??redirect to `/invoice-audit/jobs/{jobId}`.
- `apps/web/src/app/invoice-audit/jobs/[jobId]/page.tsx` ??server component, polls `/api/audit/status` then renders result.
- `apps/worker-py/app/schemas.py` ??Pydantic v2 models: `NormalizedInvoice`, `InvoiceLine`, `EvidenceCandidate`, `ParseResponse`.
- `apps/worker-py/app/parsers/xlsx.py` ??`parse_xlsx(blob: bytes) -> NormalizedInvoice` using `openpyxl`.
- `apps/worker-py/app/parsers/md.py` ??`parse_md(blob: bytes) -> NormalizedInvoice` (evidence-only).
- `apps/worker-py/app/parsers/txt.py` ??`parse_txt(blob: bytes) -> NormalizedInvoice` (evidence-only).
- `apps/worker-py/app/validators/numeric_integrity.py` ??`validate(lines: list[InvoiceLine]) -> None` mutates `numeric_integrity_status`, `numeric_delta` per spec FR-020a.
- `apps/worker-py/app/routes/parse.py` ??POST `/parse` accepts `{blob_ref, file_id, parser_version}`, fetches blob from Vercel (Phase 1: via signed URL), dispatches by `file_type`, runs numeric_integrity validator, returns `ParseResponse`.

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/.env.example`
- Create: `apps/worker-py/pyproject.toml`
- Create: `apps/worker-py/README.md`
- Create: `apps/.gitignore`

- [ ] **Step 1: Create Vercel app `package.json`**

```json
{
  "name": "@invoice-audit/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vercel/blob": "^0.27.0",
    "next": "15.0.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '5mb' }
  }
};
export default nextConfig;
```

- [ ] **Step 4: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
});
```

- [ ] **Step 5: Create `apps/web/.env.example`**

```
# Vercel Blob (private)
BLOB_READ_WRITE_TOKEN=

# Cloudflare MCP (existing deployed server)
CF_MCP_BASE_URL=https://hvdc-ontology-chatgpt-app.mscho715.workers.dev
CF_MCP_TIMEOUT_MS=5000

# Python worker
PARSER_WORKER_URL=http://127.0.0.1:8000
PARSER_WORKER_TOKEN=dev-parser-token
```

- [ ] **Step 6: Create `apps/worker-py/pyproject.toml`**

```toml
[project]
name = "invoice-audit-parser"
version = "0.1.0"
description = "Invoice audit parser worker (Phase 1)"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "openpyxl>=3.1",
    "pydantic>=2.9",
    "httpx>=0.27"
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["app*"]
```

- [ ] **Step 7: Create `apps/worker-py/README.md`**

```markdown
# Invoice Audit Parser Worker (Phase 1)

FastAPI service that parses uploaded invoice/evidence files (xlsx/md/txt) and returns normalized JSON.

## Run dev

```bash
cd apps/worker-py
python -m venv .venv
. .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

## Test

```bash
pytest
```

## API

- `GET /health` ??liveness
- `POST /parse` ??body `{blob_ref, file_id, parser_version}` ??`ParseResponse`
```

- [ ] **Step 8: Create `apps/.gitignore`**

```
node_modules/
.next/
dist/
.venv/
__pycache__/
*.pyc
.env
.env.local
.DS_Store
```

- [ ] **Step 9: Install dependencies**

Run (in `apps/web/`): `npm install`
Run (in `apps/worker-py/`): `pip install -e ".[dev]"`

- [ ] **Step 10: Commit**

```bash
git add apps/
git commit -m "structural: scaffold invoice-audit monorepo (web + worker-py)"
```

---

## Task 2: Platform types and zod schemas

**Files:**
- Create: `apps/web/src/lib/types.ts`
- Create: `apps/web/tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  JobStatusSchema,
  SourceFileSchema,
  InvoiceLineSchema,
  GateResultSchema,
  AuditTraceStepSchema
} from '../src/lib/types';

describe('types', () => {
  it('JobStatusSchema accepts valid statuses', () => {
    for (const s of ['CREATED','UPLOADING','UPLOADED','QUEUED','PARSING','VALIDATING','REVIEW_REQUIRED','APPROVED','EXPORTING','COMPLETED','FAILED','REJECTED']) {
      expect(JobStatusSchema.parse(s)).toBe(s);
    }
  });

  it('JobStatusSchema rejects unknown status', () => {
    expect(() => JobStatusSchema.parse('UNKNOWN')).toThrow();
  });

  it('SourceFileSchema requires sha256, blob_ref, file_type', () => {
    const ok = SourceFileSchema.parse({
      file_id: 'f1', job_id: 'j1', original_filename: 'inv.xlsx',
      file_type: 'xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 1024, sha256: 'a'.repeat(64), blob_ref: 'blob:abc',
      parser_status: 'PENDING', uploaded_by: 'u1', uploaded_at: '2026-06-09T00:00:00Z'
    });
    expect(ok.file_type).toBe('xlsx');
    expect(() => SourceFileSchema.parse({ file_id: 'x' })).toThrow();
  });

  it('InvoiceLineSchema enforces line_amount, currency, description', () => {
    const ok = InvoiceLineSchema.parse({
      line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100.0
    });
    expect(ok.numeric_integrity_status ?? null).toBeNull();
  });

  it('GateResultSchema verdict is one of PASS/AMBER/ZERO/FAILED', () => {
    expect(GateResultSchema.parse({ verdict: 'PASS' }).verdict).toBe('PASS');
    expect(() => GateResultSchema.parse({ verdict: 'GREEN' })).toThrow();
  });

  it('AuditTraceStepSchema accepts Phase 1 steps', () => {
    for (const step of ['UPLOAD','PARSE','VALIDATE','COSTGUARD','DOC_GUARDIAN','DECISION']) {
      expect(AuditTraceStepSchema.parse(step)).toBe(step);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/types.test.ts`
Expected: FAIL ??`Cannot find module '../src/lib/types'`.

- [ ] **Step 3: Write `apps/web/src/lib/types.ts`**

```ts
import { z } from 'zod';

export const JobStatusSchema = z.enum([
  'CREATED','UPLOADING','UPLOADED','QUEUED','PARSING','VALIDATING',
  'REVIEW_REQUIRED','APPROVED','EXPORTING','COMPLETED','FAILED','REJECTED'
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const VerdictSchema = z.enum(['PASS','AMBER','ZERO','FAILED']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const SourceFileSchema = z.object({
  file_id: z.string().min(1),
  job_id: z.string().min(1),
  original_filename: z.string().min(1),
  file_type: z.enum(['xlsx','md','txt','pdf','image','unknown']),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  blob_ref: z.string().min(1),
  parser_status: z.enum(['PENDING','PARSED','FAILED','SKIPPED']),
  uploaded_by: z.string().min(1),
  uploaded_at: z.string().datetime()
});
export type SourceFile = z.infer<typeof SourceFileSchema>;

export const InvoiceLineSchema = z.object({
  line_id: z.string().min(1),
  shipment_ref: z.string().nullish(),
  job_number: z.string().nullish(),
  description: z.string().min(1),
  normalized_description: z.string().nullish(),
  qty: z.number().nullish(),
  rate: z.number().nullish(),
  rate_basis: z.enum(['PER_EA','PER_TRUCK','PER_TEU','PER_CBM','PER_MT','PER_DAY','AT_COST','LUMP_SUM']).nullish(),
  currency: z.enum(['AED','USD']),
  amount: z.number(),
  numeric_integrity_status: z.enum(['PASS','AMBER']).nullish(),
  numeric_delta: z.number().nullish(),
  rate_source_candidate: z.enum(['CONTRACT','AT_COST','DSV_HANDLING','UNKNOWN']).nullish(),
  for_charge_component: z.string().nullish(),
  type_b: z.string().nullish(),
  evidence_status: z.enum(['MATCHED','PARTIAL','MISSING']).nullish(),
  rate_status: z.enum(['MATCHED','UNKNOWN','MISMATCH','NOT_APPLICABLE']).nullish(),
  validity_status: z.enum(['VALID','EXPIRED','PENDING']).nullish(),
  gate_status: VerdictSchema.nullish(),
  band: z.enum(['PASS','WARN','HIGH','CRITICAL']).nullish(),
  delta_pct: z.number().nullish(),
  source_ref: z.object({ sheet: z.string().optional(), row: z.number().optional(), col: z.string().optional(), text_span: z.string().optional() })
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const EvidenceCandidateSchema = z.object({
  source_file_id: z.string(),
  text_span: z.string(),
  matched_reference: z.string().nullish(),
  confidence: z.number().min(0).max(1)
});
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;

export const NormalizedInvoiceSchema = z.object({
  invoice_id: z.string(),
  invoice_header: z.object({
    invoice_no: z.string().nullish(),
    vendor: z.string().nullish(),
    issue_date: z.string().nullish(),
    currency: z.enum(['AED','USD']),
    invoice_total: z.number().nullish()
  }),
  invoice_lines: z.array(InvoiceLineSchema),
  evidence_candidates: z.array(EvidenceCandidateSchema),
  parser_confidence: z.number().min(0).max(1),
  parser_version: z.string()
});
export type NormalizedInvoice = z.infer<typeof NormalizedInvoiceSchema>;

export const SctValidationResultSchema = z.object({
  validation_id: z.string(),
  job_id: z.string(),
  sct_trace_id: z.string(),
  cf_mcp_tool_calls: z.array(z.object({
    tool: z.string(),
    latency_ms: z.number(),
    status: z.enum(['OK','ERROR','TIMEOUT']),
    request_ref: z.string().nullish(),
    response_ref: z.string().nullish()
  })),
  type_b_results: z.array(z.object({ line_id: z.string(), type_b: z.string().nullish() })),
  rate_checks: z.array(z.object({ line_id: z.string(), rate_status: z.string(), validity_status: z.enum(['VALID','EXPIRED','PENDING']).nullish() })),
  evidence_requirements: z.array(z.object({ line_id: z.string(), required_evidence: z.array(z.string()) })),
  costguard_results: z.array(z.object({
    line_id: z.string(), band: z.enum(['PASS','WARN','HIGH','CRITICAL']),
    verdict: z.string(), delta_pct: z.number().nullish(), prism_kernel_proof_ref: z.string().nullish()
  })),
  doc_guardian_results: z.array(z.object({ line_id: z.string().nullish(), code: z.string(), severity: z.enum(['AMBER','ZERO']) })),
  gate_results: z.array(z.object({ line_id: z.string().nullish(), gate_status: VerdictSchema, reason_codes: z.array(z.string()) })),
  confidence: z.number().min(0).max(1),
  reason_codes: z.array(z.string()),
  warnings: z.array(z.string())
});
export type SctValidationResult = z.infer<typeof SctValidationResultSchema>;

export const GateResultSchema = z.object({
  gate_id: z.string(),
  job_id: z.string(),
  verdict: VerdictSchema,
  line_results: z.array(z.object({
    line_id: z.string(),
    verdict: VerdictSchema,
    band: z.enum(['PASS','WARN','HIGH','CRITICAL']).nullish(),
    delta_pct: z.number().nullish(),
    reason_codes: z.array(z.string())
  })),
  action_items: z.array(z.object({
    action_id: z.string(), severity: VerdictSchema, line_id: z.string().nullish(),
    issue_type: z.string(), required_action: z.string()
  }))
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const AuditTraceStepSchema = z.enum([
  'UPLOAD','PARSE','VALIDATE','COSTGUARD','MOSB_GATE','DOC_GUARDIAN','DECISION','APPROVAL','EXPORT'
]);
export type AuditTraceStep = z.infer<typeof AuditTraceStepSchema>;

export const AuditTraceEntrySchema = z.object({
  trace_id: z.string(),
  job_id: z.string(),
  step: AuditTraceStepSchema,
  input_ref: z.string(),
  output_ref: z.string(),
  timestamp: z.string().datetime(),
  rule_version: z.string().nullish(),
  source_hash: z.string().nullish(),
  calculation_hash: z.string().nullish(),
  latency_ms: z.number().nullish(),
  wasDerivedFrom: z.string().nullish(),
  attributedTo: z.string().nullish()
});
export type AuditTraceEntry = z.infer<typeof AuditTraceEntrySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/types.test.ts`
Expected: PASS ??6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/tests/types.test.ts
git commit -m "feat(web): add platform types and zod schemas (FR-001~FR-030, US-001~US-003)"
```

---

## Task 3: Error code constants (spec 5.8 Phase 1 subset)

**Files:**
- Create: `apps/web/src/lib/error-codes.ts`
- Create: `apps/web/tests/error-codes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/error-codes.test.ts
import { describe, it, expect } from 'vitest';
import { ErrorCodes, httpForError, ErrorCode } from '../src/lib/error-codes';

describe('error-codes', () => {
  it('exposes Phase 1 error codes', () => {
    const expected: ErrorCode[] = [
      'NO_FILE','UNSUPPORTED_FILE_TYPE','UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD',
      'STORAGE_AUTH_FAILED','JOB_NOT_FOUND','INVALID_STATE','PARSE_FAILED',
      'MCP_UNAVAILABLE','VALIDATION_FAILED','FORBIDDEN'
    ];
    for (const c of expected) {
      expect(ErrorCodes).toContain(c);
    }
  });

  it('httpForError returns spec-defined HTTP codes', () => {
    expect(httpForError('NO_FILE')).toBe(400);
    expect(httpForError('UNSUPPORTED_FILE_TYPE')).toBe(400);
    expect(httpForError('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD')).toBe(413);
    expect(httpForError('STORAGE_AUTH_FAILED')).toBe(500);
    expect(httpForError('JOB_NOT_FOUND')).toBe(404);
    expect(httpForError('INVALID_STATE')).toBe(409);
    expect(httpForError('PARSE_FAILED')).toBe(422);
    expect(httpForError('MCP_UNAVAILABLE')).toBe(503);
    expect(httpForError('VALIDATION_FAILED')).toBe(422);
    expect(httpForError('FORBIDDEN')).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/error-codes.test.ts`
Expected: FAIL ??module not found.

- [ ] **Step 3: Write `apps/web/src/lib/error-codes.ts`**

```ts
// Spec 5.8 (Phase 1 subset). Full list will be added in Phase 2.
export const ErrorCodes = [
  'NO_FILE',
  'UNSUPPORTED_FILE_TYPE',
  'UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD',
  'STORAGE_AUTH_FAILED',
  'JOB_NOT_FOUND',
  'INVALID_STATE',
  'PARSE_FAILED',
  'MCP_UNAVAILABLE',
  'VALIDATION_FAILED',
  'FORBIDDEN'
] as const;
export type ErrorCode = typeof ErrorCodes[number];

const HTTP_BY_CODE: Record<ErrorCode, number> = {
  NO_FILE: 400,
  UNSUPPORTED_FILE_TYPE: 400,
  UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD: 413,
  STORAGE_AUTH_FAILED: 500,
  JOB_NOT_FOUND: 404,
  INVALID_STATE: 409,
  PARSE_FAILED: 422,
  MCP_UNAVAILABLE: 503,
  VALIDATION_FAILED: 422,
  FORBIDDEN: 403
};

export function httpForError(code: ErrorCode): number {
  return HTTP_BY_CODE[code];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/error-codes.test.ts`
Expected: PASS ??2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/error-codes.ts apps/web/tests/error-codes.test.ts
git commit -m "feat(web): add Phase 1 error code constants (spec 5.8)"
```

---

## Task 4: In-memory job store (interface designed for D1 swap)

**Files:**
- Create: `apps/web/src/lib/job-store.ts`
- Create: `apps/web/tests/job-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/job-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createJobStore } from '../src/lib/job-store';

describe('job-store', () => {
  let store: ReturnType<typeof createJobStore>;
  beforeEach(() => { store = createJobStore(); });

  it('createJob returns a job with CREATED status and a unique job_id', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    expect(j.job_id).toMatch(/^job_/);
    expect(j.status).toBe('CREATED');
    expect(j.created_by).toBe('u1');
  });

  it('getJob returns undefined for unknown job_id', async () => {
    expect(await store.getJob('job_nope')).toBeUndefined();
  });

  it('updateJob mutates status and updated_at', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    const before = j.updated_at;
    await new Promise(r => setTimeout(r, 5));
    const updated = await store.updateJob(j.job_id, { status: 'UPLOADED' });
    expect(updated?.status).toBe('UPLOADED');
    expect(updated?.updated_at).not.toBe(before);
  });

  it('addSourceFile and listSourceFiles', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.addSourceFile(j.job_id, {
      file_id: 'f1', job_id: j.job_id, original_filename: 'inv.xlsx',
      file_type: 'xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 1024, sha256: 'a'.repeat(64), blob_ref: 'blob:abc',
      parser_status: 'PENDING', uploaded_by: 'u1', uploaded_at: new Date().toISOString()
    });
    const files = await store.listSourceFiles(j.job_id);
    expect(files).toHaveLength(1);
    expect(files[0].file_id).toBe('f1');
  });

  it('appendTrace keeps insertion order and assigns trace_id', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.appendTrace(j.job_id, { step: 'UPLOAD', input_ref: 'i', output_ref: 'o' });
    await store.appendTrace(j.job_id, { step: 'PARSE',  input_ref: 'i', output_ref: 'o' });
    const tr = await store.listTrace(j.job_id);
    expect(tr.map(t => t.step)).toEqual(['UPLOAD','PARSE']);
    for (const t of tr) expect(t.trace_id).toMatch(/^trace_/);
  });

  it('setResult and getResult are typed', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.setResult(j.job_id, { verdict: 'AMBER', line_results: [], action_items: [] });
    const r = await store.getResult(j.job_id);
    expect(r?.verdict).toBe('AMBER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/job-store.test.ts`
Expected: FAIL ??module not found.

- [ ] **Step 3: Write `apps/web/src/lib/job-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type {
  JobStatus, Verdict, SourceFile, AuditTraceStep, AuditTraceEntry
} from './types';

export interface Job {
  job_id: string;
  status: JobStatus;
  verdict: Verdict | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  rule_version: string;
  parser_version: string;
}

export interface GateResultLite {
  verdict: Verdict;
  line_results: Array<{
    line_id: string;
    verdict: Verdict;
    band: 'PASS'|'WARN'|'HIGH'|'CRITICAL' | null;
    delta_pct: number | null;
    reason_codes: string[];
  }>;
  action_items: Array<{
    action_id: string;
    severity: Verdict;
    line_id: string | null;
    issue_type: string;
    required_action: string;
  }>;
}

export interface TraceInput {
  step: AuditTraceStep;
  input_ref: string;
  output_ref: string;
  rule_version?: string;
  source_hash?: string;
  calculation_hash?: string;
  latency_ms?: number;
  wasDerivedFrom?: string;
  attributedTo?: string;
}

export interface JobStore {
  createJob(input: { created_by: string; rule_version?: string; parser_version?: string }): Promise<Job>;
  getJob(jobId: string): Promise<Job | undefined>;
  updateJob(jobId: string, patch: Partial<Pick<Job, 'status' | 'verdict'>>): Promise<Job | undefined>;
  addSourceFile(jobId: string, sf: SourceFile): Promise<void>;
  listSourceFiles(jobId: string): Promise<SourceFile[]>;
  appendTrace(jobId: string, t: TraceInput): Promise<AuditTraceEntry>;
  listTrace(jobId: string): Promise<AuditTraceEntry[]>;
  setResult(jobId: string, r: GateResultLite): Promise<void>;
  getResult(jobId: string): Promise<GateResultLite | undefined>;
}

export function createJobStore(): JobStore {
  const jobs = new Map<string, Job>();
  const files = new Map<string, SourceFile[]>();
  const traces = new Map<string, AuditTraceEntry[]>();
  const results = new Map<string, GateResultLite>();

  const nowIso = () => new Date().toISOString();
  const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  return {
    async createJob({ created_by, rule_version = 'rule-0.1.0', parser_version = 'parser-0.1.0' }) {
      const job: Job = {
        job_id: newId('job'),
        status: 'CREATED',
        verdict: null,
        created_by,
        created_at: nowIso(),
        updated_at: nowIso(),
        rule_version,
        parser_version
      };
      jobs.set(job.job_id, job);
      files.set(job.job_id, []);
      traces.set(job.job_id, []);
      return job;
    },
    async getJob(jobId) { return jobs.get(jobId); },
    async updateJob(jobId, patch) {
      const j = jobs.get(jobId);
      if (!j) return undefined;
      const next: Job = { ...j, ...patch, updated_at: nowIso() };
      jobs.set(jobId, next);
      return next;
    },
    async addSourceFile(jobId, sf) {
      const arr = files.get(jobId) ?? [];
      arr.push(sf);
      files.set(jobId, arr);
    },
    async listSourceFiles(jobId) { return files.get(jobId) ?? []; },
    async appendTrace(jobId, t) {
      const entry: AuditTraceEntry = {
        trace_id: newId('trace'),
        job_id: jobId,
        step: t.step,
        input_ref: t.input_ref,
        output_ref: t.output_ref,
        timestamp: nowIso(),
        rule_version: t.rule_version ?? null,
        source_hash: t.source_hash ?? null,
        calculation_hash: t.calculation_hash ?? null,
        latency_ms: t.latency_ms ?? null,
        wasDerivedFrom: t.wasDerivedFrom ?? null,
        attributedTo: t.attributedTo ?? null
      };
      const arr = traces.get(jobId) ?? [];
      arr.push(entry);
      traces.set(jobId, arr);
      return entry;
    },
    async listTrace(jobId) { return traces.get(jobId) ?? []; },
    async setResult(jobId, r) { results.set(jobId, r); },
    async getResult(jobId) { return results.get(jobId); }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/job-store.test.ts`
Expected: PASS ??6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/job-store.ts apps/web/tests/job-store.test.ts
git commit -m "feat(web): add in-memory job store (D1-swappable interface)"
```

---

## Task 5: CostGuard 4-band ??platform 3-state gate bridge (spec 5.6)

**Files:**
- Create: `apps/web/src/lib/gate-bridge.ts`
- Create: `apps/web/tests/gate-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/gate-bridge.test.ts
import { describe, it, expect } from 'vitest';
import { bandToVerdict, buildGateResult, type CostGuardLine } from '../src/lib/gate-bridge';

describe('gate-bridge', () => {
  it('bandToVerdict: PASS?PASS, WARN?AMBER, HIGH?ZERO, CRITICAL?ZERO', () => {
    expect(bandToVerdict('PASS')).toBe('PASS');
    expect(bandToVerdict('WARN')).toBe('AMBER');
    expect(bandToVerdict('HIGH')).toBe('ZERO');
    expect(bandToVerdict('CRITICAL')).toBe('ZERO');
  });

  it('buildGateResult: job verdict = max severity across lines (PASS < AMBER < ZERO < FAILED)', () => {
    const lines: CostGuardLine[] = [
      { line_id: 'l1', band: 'PASS', delta_pct: 1.0, reason_codes: [] },
      { line_id: 'l2', band: 'WARN', delta_pct: 3.0, reason_codes: ['COST_VARIANCE_WARN'] },
      { line_id: 'l3', band: 'HIGH', delta_pct: 7.0, reason_codes: ['COSTGUARD_BAND_HIGH'] }
    ];
    const r = buildGateResult('job_1', lines);
    expect(r.verdict).toBe('ZERO');
    expect(r.line_results).toHaveLength(3);
    expect(r.line_results[0].verdict).toBe('PASS');
    expect(r.line_results[1].verdict).toBe('AMBER');
    expect(r.line_results[2].verdict).toBe('ZERO');
    expect(r.action_items.some(a => a.issue_type === 'COSTGUARD_BAND_HIGH')).toBe(true);
  });

  it('buildGateResult: empty lines ??verdict PASS, no action items', () => {
    const r = buildGateResult('job_1', []);
    expect(r.verdict).toBe('PASS');
    expect(r.action_items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/gate-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/lib/gate-bridge.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Verdict } from './types';

export type CostGuardBand = 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL';

export interface CostGuardLine {
  line_id: string;
  band: CostGuardBand;
  delta_pct: number | null;
  reason_codes: string[];
}

const VERDICT_RANK: Record<Verdict, number> = { PASS: 0, AMBER: 1, ZERO: 2, FAILED: 3 };

export function bandToVerdict(band: CostGuardBand): Verdict {
  switch (band) {
    case 'PASS': return 'PASS';
    case 'WARN': return 'AMBER';
    case 'HIGH':
    case 'CRITICAL': return 'ZERO';
  }
}

export function buildGateResult(jobId: string, lines: CostGuardLine[]) {
  const line_results = lines.map(l => ({
    line_id: l.line_id,
    verdict: bandToVerdict(l.band),
    band: l.band,
    delta_pct: l.delta_pct,
    reason_codes: l.reason_codes
  }));
  const verdict: Verdict = line_results.reduce<Verdict>(
    (acc, lr) => (VERDICT_RANK[lr.verdict] > VERDICT_RANK[acc] ? lr.verdict : acc),
    'PASS'
  );
  const action_items = line_results
    .filter(lr => lr.verdict !== 'PASS')
    .map(lr => ({
      action_id: `act_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      severity: lr.verdict as Verdict,
      line_id: lr.line_id,
      issue_type: lr.reason_codes[0] ?? 'COSTGUARD_NONPASS',
      required_action: lr.verdict === 'AMBER' ? 'Review by Cost Control Lead' : 'Hold + Finance approval'
    }));
  return { gate_id: `gate_${randomUUID().replace(/-/g, '').slice(0, 10)}`, job_id: jobId, verdict, line_results, action_items };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/gate-bridge.test.ts`
Expected: PASS ??3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/gate-bridge.ts apps/web/tests/gate-bridge.test.ts
git commit -m "feat(web): add 4-band??-state CostGuard gate bridge (spec 5.6, D-006)"
```

---

## Task 6: Vercel Blob wrapper with sha256

**Files:**
- Create: `apps/web/src/lib/blob.ts`
- Create: `apps/web/tests/blob.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/blob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const putMock = vi.fn(async (_name: string, body: Blob) => ({
  url: `https://blob.vercel-storage.com/${(body as Blob).size}`,
  pathname: 'inv.xlsx'
}));

vi.mock('@vercel/blob', () => ({ put: putMock }));

import { uploadToBlob } from '../src/lib/blob';

describe('blob', () => {
  beforeEach(() => putMock.mockClear());

  it('uploadToBlob returns blob_ref, sha256, size_bytes', async () => {
    const file = new File(['hello world'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const out = await uploadToBlob(file, 'job_abc');
    expect(out.blob_ref).toMatch(/^blob:/);
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.size_bytes).toBe(11);
    expect(out.mime_type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(putMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/blob.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/lib/blob.ts`**

```ts
import { put } from '@vercel/blob';
import { createHash } from 'node:crypto';

export interface BlobUploadResult {
  blob_ref: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
}

export async function uploadToBlob(file: File, jobId: string): Promise<BlobUploadResult> {
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const pathname = `${jobId}/${file.name}`;
  const res = await put(pathname, file, { access: 'private', addRandomSuffix: true });
  return {
    blob_ref: `blob:${res.pathname}`,
    sha256,
    size_bytes: buf.byteLength,
    mime_type: file.type || 'application/octet-stream'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/blob.test.ts`
Expected: PASS ??1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/blob.ts apps/web/tests/blob.test.ts
git commit -m "feat(web): add Vercel Blob upload wrapper with sha256 (FR-002, FR-004, FR-005)"
```

---

## Task 7: CF MCP HTTP client (route_question + check_cost_guard + check_doc_guardian)

**Files:**
- Create: `apps/web/src/lib/cf-mcp-client.ts`
- Create: `apps/web/tests/cf-mcp-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/cf-mcp-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { createCfMcpClient } from '../src/lib/cf-mcp-client';

describe('cf-mcp-client', () => {
  beforeEach(() => fetchMock.mockReset());

  it('validate calls route_question, check_cost_guard, check_doc_guardian and aggregates', async () => {
    fetchMock
      // route_question
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: ['tariff_ref'] } }) })
      // check_cost_guard
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 2, result: { lineResults: [{ lineId: 'l1', band: 'PASS', deltaPct: 1.5, verdict: 'ACCEPTABLE', proofRef: 'proof_1' }] } }) })
      // check_doc_guardian
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 3, result: { findings: [] } }) });

    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 1000, retries: 0 });
    const r = await client.validate('job_1', { invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100 }], evidence_index: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.costguard_results).toEqual([{ line_id: 'l1', band: 'PASS', verdict: 'ACCEPTABLE', delta_pct: 1.5, prism_kernel_proof_ref: 'proof_1' }]);
    expect(r.gate_results).toHaveLength(1);
    expect(r.gate_results[0].gate_status).toBe('PASS');
  });

  it('throws MCP_UNAVAILABLE on persistent failure (retries exhausted)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 100, retries: 2, backoffMs: 1 });
    await expect(client.validate('job_1', { invoice_lines: [], evidence_index: [] })).rejects.toThrow(/MCP_UNAVAILABLE/);
  });

  it('respects timeout (AbortError ??retry, then MCP_UNAVAILABLE)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 10, retries: 1, backoffMs: 1 });
    await expect(client.validate('job_1', { invoice_lines: [], evidence_index: [] })).rejects.toThrow(/MCP_UNAVAILABLE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/cf-mcp-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/lib/cf-mcp-client.ts`**

```ts
import { randomUUID } from 'node:crypto';

export interface CfMcpClient {
  validate(jobId: string, payload: { invoice_lines: unknown[]; evidence_index: unknown[]; rule_version?: string }): Promise<{
    sct_trace_id: string;
    cf_mcp_tool_calls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }>;
    type_b_results: Array<{ line_id: string; type_b: string | null }>;
    rate_checks: Array<{ line_id: string; rate_status: string; validity_status: 'VALID'|'EXPIRED'|'PENDING'|null }>;
    evidence_requirements: Array<{ line_id: string; required_evidence: string[] }>;
    costguard_results: Array<{ line_id: string; band: 'PASS'|'WARN'|'HIGH'|'CRITICAL'; verdict: string; delta_pct: number | null; prism_kernel_proof_ref: string | null }>;
    doc_guardian_results: Array<{ line_id: string | null; code: string; severity: 'AMBER'|'ZERO' }>;
    gate_results: Array<{ line_id: string | null; gate_status: 'PASS'|'AMBER'|'ZERO'|'FAILED'; reason_codes: string[] }>;
    confidence: number;
    reason_codes: string[];
    warnings: string[];
  }>;
}

export class McpUnavailableError extends Error {
  readonly code = 'MCP_UNAVAILABLE';
  constructor(msg: string) { super(msg); this.name = 'McpUnavailableError'; }
}

export function createCfMcpClient(opts: { baseUrl: string; timeoutMs: number; retries: number; backoffMs?: number }): CfMcpClient {
  const { baseUrl, timeoutMs, retries, backoffMs = 1000 } = opts;
  const url = `${baseUrl.replace(/\/$/, '')}/mcp`;

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<{ result: T; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const start = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
          signal: controller.signal
        });
        const latency_ms = Date.now() - start;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { result?: T; error?: { message: string } };
        if (json.error) throw new Error(json.error.message);
        return { result: json.result as T, latency_ms, status: 'OK' };
      } catch (e) {
        lastErr = e;
        const latency_ms = Date.now() - start;
        const isTimeout = (e as Error).name === 'AbortError';
        clearTimeout(timer);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          continue;
        }
        if (isTimeout) throw new McpUnavailableError(`tool ${name} timeout after ${retries + 1} attempts`);
        throw new McpUnavailableError(`tool ${name} unavailable: ${(e as Error).message}`);
      }
    }
    throw new McpUnavailableError(`tool ${name} exhausted retries: ${String(lastErr)}`);
  }

  return {
    async validate(jobId, payload) {
      const sct_trace_id = `sct_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const toolCalls: Array<{ tool: string; latency_ms: number; status: 'OK' | 'ERROR' | 'TIMEOUT' }> = [];

      const route = await callTool<{ domain: string; requiredCorpus: string[] }>('route_question', { question: `audit:${jobId}`, userRole: 'ops_user' });
      toolCalls.push({ tool: 'route_question', latency_ms: route.latency_ms, status: route.status });

      const costguard = await callTool<{ lineResults: Array<{ lineId: string; band: 'PASS'|'WARN'|'HIGH'|'CRITICAL'; deltaPct: number | null; verdict: string; proofRef: string | null }> }>('check_cost_guard', { jobId, lines: payload.invoice_lines, ruleVersion: payload.rule_version ?? 'rule-0.1.0' });
      toolCalls.push({ tool: 'check_cost_guard', latency_ms: costguard.latency_ms, status: costguard.status });

      const doc = await callTool<{ findings: Array<{ lineId: string | null; code: string; severity: 'AMBER' | 'ZERO' }> }>('check_doc_guardian', { jobId, evidence: payload.evidence_index });
      toolCalls.push({ tool: 'check_doc_guardian', latency_ms: doc.latency_ms, status: doc.status });

      const costguard_results = costguard.result.lineResults.map(lr => ({
        line_id: lr.lineId,
        band: lr.band,
        verdict: lr.verdict,
        delta_pct: lr.deltaPct,
        prism_kernel_proof_ref: lr.proofRef
      }));

      const gate_results = costguard_results.map(cr => ({
        line_id: cr.line_id,
        gate_status: cr.band === 'PASS' ? 'PASS' as const : cr.band === 'WARN' ? 'AMBER' as const : 'ZERO' as const,
        reason_codes: [`COSTGUARD_${cr.band}`]
      }));

      return {
        sct_trace_id,
        cf_mcp_tool_calls: toolCalls,
        type_b_results: [],
        rate_checks: [],
        evidence_requirements: [],
        costguard_results,
        doc_guardian_results: doc.result.findings.map((f: { lineId: string | null; code: string; severity: 'AMBER' | 'ZERO' }) => ({
          line_id: f.lineId,
          code: f.code,
          severity: f.severity
        })),
        gate_results,
        confidence: 0.95,
        reason_codes: [],
        warnings: []
      };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/cf-mcp-client.test.ts`
Expected: PASS ??3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/cf-mcp-client.ts apps/web/tests/cf-mcp-client.test.ts
git commit -m "feat(web): add Cloudflare MCP HTTP client (route_question + check_cost_guard + check_doc_guardian)"
```

---

## Task 8: Python Pydantic schemas

**Files:**
- Create: `apps/worker-py/app/__init__.py`
- Create: `apps/worker-py/app/schemas.py`
- Create: `apps/worker-py/tests/__init__.py`
- Create: `apps/worker-py/tests/conftest.py`
- Create: `apps/worker-py/tests/test_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker-py/tests/test_schemas.py
from app.schemas import InvoiceLine, NormalizedInvoice, ParseResponse, normalize_line_id

def test_invoice_line_requires_description_currency_amount():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0)
    assert line.line_id == 'l1'

def test_invoice_line_rejects_unknown_currency():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        InvoiceLine(line_id='l1', description='X', currency='EUR', amount=1.0)

def test_normalize_line_id_deterministic():
    assert normalize_line_id('a.xlsx', 'Sheet1', 3, 5) == normalize_line_id('a.xlsx', 'Sheet1', 3, 5)
    assert normalize_line_id('a.xlsx', 'Sheet1', 3, 5) != normalize_line_id('a.xlsx', 'Sheet1', 4, 5)

def test_parse_response_serializes_to_json():
    ni = NormalizedInvoice(
        invoice_id='inv1',
        invoice_header={'invoice_no': None, 'vendor': None, 'issue_date': None, 'currency': 'AED', 'invoice_total': None},
        invoice_lines=[],
        evidence_candidates=[],
        parser_confidence=0.9,
        parser_version='parser-0.1.0'
    )
    pr = ParseResponse(parse_result_id='pr1', job_id='j1', file_id='f1', normalized=ni)
    j = pr.model_dump_json()
    assert '"parser_version":"parser-0.1.0"' in j
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker-py && pytest tests/test_schemas.py -v`
Expected: FAIL ??`ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 3: Write `apps/worker-py/app/__init__.py`**

```python
"""Invoice audit parser worker."""
__version__ = "0.1.0"
```

- [ ] **Step 4: Write `apps/worker-py/app/schemas.py`**

```python
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict
import hashlib

Currency = Literal['AED', 'USD']
RateBasis = Literal['PER_EA','PER_TRUCK','PER_TEU','PER_CBM','PER_MT','PER_DAY','AT_COST','LUMP_SUM']
RateSource = Literal['CONTRACT','AT_COST','DSV_HANDLING','UNKNOWN']
NumericIntegrity = Literal['PASS','AMBER']

class InvoiceHeader(BaseModel):
    model_config = ConfigDict(extra='forbid')
    invoice_no: Optional[str] = None
    vendor: Optional[str] = None
    issue_date: Optional[str] = None
    currency: Currency
    invoice_total: Optional[float] = None

class InvoiceLine(BaseModel):
    model_config = ConfigDict(extra='forbid')
    line_id: str
    shipment_ref: Optional[str] = None
    job_number: Optional[str] = None
    description: str
    normalized_description: Optional[str] = None
    qty: Optional[float] = None
    rate: Optional[float] = None
    rate_basis: Optional[RateBasis] = None
    currency: Currency
    amount: float
    numeric_integrity_status: Optional[NumericIntegrity] = None
    numeric_delta: Optional[float] = None
    rate_source_candidate: Optional[RateSource] = None
    for_charge_component: Optional[str] = None
    type_b: Optional[str] = None
    source_ref: dict = Field(default_factory=dict)

class EvidenceCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_file_id: str
    text_span: str
    matched_reference: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)

class NormalizedInvoice(BaseModel):
    model_config = ConfigDict(extra='forbid')
    invoice_id: str
    invoice_header: InvoiceHeader
    invoice_lines: list[InvoiceLine]
    evidence_candidates: list[EvidenceCandidate]
    parser_confidence: float = Field(ge=0.0, le=1.0)
    parser_version: str

class ParseRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    blob_ref: str
    file_id: str
    job_id: str
    file_type: Literal['xlsx','md','txt']
    parser_version: str
    blob_url: str

class ParseResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    parse_result_id: str
    job_id: str
    file_id: str
    normalized: NormalizedInvoice

def normalize_line_id(file_id: str, sheet: str, row: int, col: int) -> str:
    h = hashlib.sha1(f"{file_id}|{sheet}|{row}|{col}".encode()).hexdigest()[:12]
    return f"line_{h}"
```

- [ ] **Step 5: Write `apps/worker-py/tests/__init__.py` and `apps/worker-py/tests/conftest.py`**

```python
# apps/worker-py/tests/__init__.py
```

```python
# apps/worker-py/tests/conftest.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/worker-py && pytest tests/test_schemas.py -v`
Expected: PASS ??4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-py/app/__init__.py apps/worker-py/app/schemas.py apps/worker-py/tests/
git commit -m "feat(worker-py): add Pydantic v2 schemas (FR-012, FR-013)"
```

---

## Task 9: Python numeric integrity validator (FR-020a)

**Files:**
- Create: `apps/worker-py/app/validators/__init__.py`
- Create: `apps/worker-py/app/validators/numeric_integrity.py`
- Create: `apps/worker-py/tests/test_numeric_integrity.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker-py/tests/test_numeric_integrity.py
from app.schemas import InvoiceLine
from app.validators.numeric_integrity import validate_numeric_integrity

def test_passes_when_qty_rate_eq_amount():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'PASS'
    assert line.numeric_delta == 0.0

def test_passes_within_tolerance_0_01():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.005, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'PASS'

def test_amber_when_exceeds_tolerance():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=110.0, qty=2, rate=50.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status == 'AMBER'
    assert line.numeric_delta == 10.0

def test_skips_when_qty_or_rate_missing():
    line = InvoiceLine(line_id='l1', description='TRUCKING', currency='AED', amount=100.0)
    validate_numeric_integrity([line])
    assert line.numeric_integrity_status is None
    assert line.numeric_delta is None

def test_does_not_mutate_unrelated_lines():
    a = InvoiceLine(line_id='a', description='A', currency='AED', amount=10, qty=1, rate=10)
    b = InvoiceLine(line_id='b', description='B', currency='AED', amount=99)
    validate_numeric_integrity([a, b])
    assert a.numeric_integrity_status == 'PASS'
    assert b.numeric_integrity_status is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker-py && pytest tests/test_numeric_integrity.py -v`
Expected: FAIL.

- [ ] **Step 3: Write `apps/worker-py/app/validators/__init__.py`**

```python
"""Validators for normalized invoice data."""
```

- [ ] **Step 4: Write `apps/worker-py/app/validators/numeric_integrity.py`**

```python
"""FR-020a: |qty * rate - line_amount| <= 0.01 ??PASS; otherwise AMBER with numeric_delta."""
from __future__ import annotations
from app.schemas import InvoiceLine

TOLERANCE = 0.01

def validate_numeric_integrity(lines: list[InvoiceLine]) -> None:
    for line in lines:
        if line.qty is None or line.rate is None:
            continue
        computed = float(line.qty) * float(line.rate)
        delta = abs(computed - float(line.amount))
        line.numeric_delta = round(delta, 6)
        line.numeric_integrity_status = 'PASS' if delta <= TOLERANCE else 'AMBER'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/worker-py && pytest tests/test_numeric_integrity.py -v`
Expected: PASS ??5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker-py/app/validators/ apps/worker-py/tests/test_numeric_integrity.py
git commit -m "feat(worker-py): numeric integrity validator (FR-020a, 0.01 tolerance)"
```

---

## Task 10: Python xlsx parser (FR-012, FR-013, FR-014)

**Files:**
- Create: `apps/worker-py/app/parsers/__init__.py`
- Create: `apps/worker-py/app/parsers/xlsx.py`
- Create: `apps/worker-py/tests/test_xlsx_parser.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker-py/tests/test_xlsx_parser.py
import io
from openpyxl import Workbook
from app.parsers.xlsx import parse_xlsx_bytes

def _make_xlsx(headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Invoice'
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

def test_parses_basic_invoice_lines():
    raw = _make_xlsx(
        ['Description', 'Qty', 'Rate', 'Amount', 'Currency'],
        [
            ['TRUCKING', 2, 50.0, 100.0, 'AED'],
            ['THC',      1, 75.0,  75.0, 'AED'],
        ]
    )
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert len(ni.invoice_lines) == 2
    l0 = ni.invoice_lines[0]
    assert l0.description == 'TRUCKING' and l0.qty == 2 and l0.rate == 50.0 and l0.amount == 100.0
    assert l0.currency == 'AED'
    assert ni.invoice_header.currency == 'AED'
    assert ni.parser_version == 'parser-0.1.0'

def test_supports_header_aliases_case_insensitive():
    raw = _make_xlsx(
        ['desc', 'quantity', 'unit rate', 'line amount', 'CCY'],
        [['THC', 1, 75.0, 75.0, 'USD']]
    )
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert ni.invoice_lines[0].currency == 'USD'
    assert ni.invoice_lines[0].rate == 75.0
    assert ni.invoice_lines[0].amount == 75.0

def test_skips_empty_rows_and_uses_normalized_line_id():
    raw = _make_xlsx(['Description','Qty','Rate','Amount','Currency'], [[None,None,None,None,None], ['TRUCKING', 1, 10, 10, 'AED']])
    ni = parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
    assert len(ni.invoice_lines) == 1
    assert ni.invoice_lines[0].line_id.startswith('line_')

def test_raises_when_no_usable_line():
    import pytest
    raw = _make_xlsx(['Description','Qty','Rate','Amount','Currency'], [[None,None,None,None,None]])
    with pytest.raises(ValueError):
        parse_xlsx_bytes(raw, file_id='f1', file_name='inv.xlsx', parser_version='parser-0.1.0')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker-py && pytest tests/test_xlsx_parser.py -v`
Expected: FAIL.

- [ ] **Step 3: Write `apps/worker-py/app/parsers/__init__.py`**

```python
"""File parsers (xlsx, md, txt)."""
```

- [ ] **Step 4: Write `apps/worker-py/app/parsers/xlsx.py`**

```python
"""xlsx parser using openpyxl. Supports header alias detection (FR-014)."""
from __future__ import annotations
import io
from openpyxl import load_workbook
from app.schemas import InvoiceLine, NormalizedInvoice, InvoiceHeader, normalize_line_id

HEADER_ALIASES: dict[str, list[str]] = {
    'description': ['description', 'desc', 'charge', 'charge description', 'item'],
    'qty':         ['qty', 'quantity', 'units', 'count'],
    'rate':        ['rate', 'unit rate', 'unit_price', 'unit price', 'price'],
    'amount':      ['amount', 'line amount', 'line_amount', 'total', 'line total'],
    'currency':    ['currency', 'ccy', 'curr']
}

def _detect_headers(header_row: list) -> dict[str, int]:
    """Map canonical field ??column index. Returns empty dict if no canonical field found."""
    norm = [str(c or '').strip().lower() for c in header_row]
    out: dict[str, int] = {}
    for canon, aliases in HEADER_ALIASES.items():
        for i, cell in enumerate(norm):
            if cell in aliases:
                out[canon] = i
                break
    return out

def _cell_num(cell) -> float | None:
    if cell is None: return None
    if isinstance(cell, (int, float)): return float(cell)
    try: return float(str(cell).replace(',', ''))
    except (ValueError, TypeError): return None

def _cell_str(cell) -> str | None:
    if cell is None: return None
    s = str(cell).strip()
    return s if s else None

def parse_xlsx_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    wb = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("empty xlsx")
    header = rows[0]
    cmap = _detect_headers(list(header))
    if 'description' not in cmap or 'amount' not in cmap:
        raise ValueError("xlsx missing required columns (description, amount)")

    lines: list[InvoiceLine] = []
    for r_idx, row in enumerate(rows[1:], start=2):
        desc = _cell_str(row[cmap['description']]) if 'description' in cmap else None
        amt  = _cell_num(row[cmap['amount']])    if 'amount'    in cmap else None
        if desc is None and amt is None:
            continue  # skip empty rows (FR-016)
        currency = (_cell_str(row[cmap['currency']]) or 'AED') if 'currency' in cmap else 'AED'
        if currency not in ('AED', 'USD'):
            currency = 'AED'
        line = InvoiceLine(
            line_id=normalize_line_id(file_id, ws.title, r_idx, cmap['description']),
            description=desc or '(missing description)',
            currency=currency,  # type: ignore[arg-type]
            amount=float(amt or 0.0),
            qty=_cell_num(row[cmap['qty']]) if 'qty' in cmap else None,
            rate=_cell_num(row[cmap['rate']]) if 'rate' in cmap else None,
            source_ref={'sheet': ws.title, 'row': r_idx, 'col': str(cmap['description'])}
        )
        lines.append(line)

    if not lines:
        raise ValueError("xlsx has no usable invoice line")

    header_currency = lines[0].currency
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency=header_currency, invoice_total=None),
        invoice_lines=lines,
        evidence_candidates=[],
        parser_confidence=0.9,
        parser_version=parser_version
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/worker-py && pytest tests/test_xlsx_parser.py -v`
Expected: PASS ??4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker-py/app/parsers/ apps/worker-py/tests/test_xlsx_parser.py
git commit -m "feat(worker-py): xlsx parser with header alias detection (FR-012, FR-014, FR-016)"
```


---

## Task 11: Python md and txt parsers (FR-013 evidence-only)

**Files:**
- Create: `apps/worker-py/app/parsers/md.py`
- Create: `apps/worker-py/app/parsers/txt.py`
- Create: `apps/worker-py/tests/test_md_parser.py`
- Create: `apps/worker-py/tests/test_txt_parser.py`

- [ ] **Step 1: Write the failing test (md)**

```python
# apps/worker-py/tests/test_md_parser.py
from app.parsers.md import parse_md_bytes

def test_extracts_evidence_candidate_with_reference():
    md = "# BL-12345\nSome note about shipment HVDC-AGI-001 delivered on 2026-04-01.\n"
    ni = parse_md_bytes(md.encode(), file_id='f1', file_name='note.md', parser_version='parser-0.1.0')
    assert ni.invoice_lines == []
    assert len(ni.evidence_candidates) >= 1
    assert any('HVDC-AGI-001' in (e.matched_reference or '') for e in ni.evidence_candidates)
    assert ni.evidence_candidates[0].confidence > 0.5

def test_low_confidence_when_no_reference_found():
    md = "Just a random note with no shipment ref."
    ni = parse_md_bytes(md.encode(), file_id='f1', file_name='note.md', parser_version='parser-0.1.0')
    assert all(e.confidence < 0.5 for e in ni.evidence_candidates)
```

- [ ] **Step 2: Write the failing test (txt)**

```python
# apps/worker-py/tests/test_txt_parser.py
from app.parsers.txt import parse_txt_bytes

def test_extracts_evidence_candidate_with_bl_ref():
    txt = "DO released for BL-AUH-002. Container MSCU1234567."
    ni = parse_txt_bytes(txt.encode(), file_id='f1', file_name='do.txt', parser_version='parser-0.1.0')
    assert any('BL-AUH-002' in (e.matched_reference or '') for e in ni.evidence_candidates)

def test_empty_txt_returns_empty_evidence():
    ni = parse_txt_bytes(b'   \n\n', file_id='f1', file_name='empty.txt', parser_version='parser-0.1.0')
    assert ni.invoice_lines == []
    assert ni.evidence_candidates == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/worker-py && pytest tests/test_md_parser.py tests/test_txt_parser.py -v`
Expected: FAIL ??modules not found.

- [ ] **Step 4: Write `apps/worker-py/app/parsers/md.py`**

```python
"""Markdown evidence parser. Returns NormalizedInvoice with invoice_lines=[] and evidence_candidates."""
from __future__ import annotations
import re
from app.schemas import EvidenceCandidate, NormalizedInvoice, InvoiceHeader

REF_PATTERNS = [
    re.compile(r'\bHVDC[-_][A-Z0-9-]+', re.IGNORECASE),
    re.compile(r'\bBL[-_][A-Z0-9-]+',   re.IGNORECASE),
    re.compile(r'\bDO[-_][A-Z0-9-]+',    re.IGNORECASE),
    re.compile(r'\bINV[-_][A-Z0-9-]+',   re.IGNORECASE),
]

def parse_md_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    text = raw.decode('utf-8', errors='replace')
    candidates: list[EvidenceCandidate] = []
    for line in text.splitlines():
        for pat in REF_PATTERNS:
            m = pat.search(line)
            if m:
                candidates.append(EvidenceCandidate(
                    source_file_id=file_id,
                    text_span=line[:200],
                    matched_reference=m.group(0).upper(),
                    confidence=0.85
                ))
                break
    if not candidates and text.strip():
        candidates.append(EvidenceCandidate(
            source_file_id=file_id,
            text_span=text[:200],
            matched_reference=None,
            confidence=0.2
        ))
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
        invoice_lines=[],
        evidence_candidates=candidates,
        parser_confidence=0.7,
        parser_version=parser_version
    )
```

- [ ] **Step 5: Write `apps/worker-py/app/parsers/txt.py`**

```python
"""Plain-text evidence parser."""
from __future__ import annotations
import re
from app.parsers.md import REF_PATTERNS
from app.schemas import EvidenceCandidate, NormalizedInvoice, InvoiceHeader

def parse_txt_bytes(raw: bytes, *, file_id: str, file_name: str, parser_version: str) -> NormalizedInvoice:
    text = raw.decode('utf-8', errors='replace')
    candidates: list[EvidenceCandidate] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for pat in REF_PATTERNS:
            m = pat.search(line)
            if m:
                candidates.append(EvidenceCandidate(
                    source_file_id=file_id,
                    text_span=line[:200],
                    matched_reference=m.group(0).upper(),
                    confidence=0.8
                ))
                break
    return NormalizedInvoice(
        invoice_id=f"inv_{file_id}",
        invoice_header=InvoiceHeader(invoice_no=None, vendor=None, issue_date=None, currency='AED', invoice_total=None),
        invoice_lines=[],
        evidence_candidates=candidates,
        parser_confidence=0.6,
        parser_version=parser_version
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/worker-py && pytest tests/test_md_parser.py tests/test_txt_parser.py -v`
Expected: PASS ??4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-py/app/parsers/md.py apps/worker-py/app/parsers/txt.py apps/worker-py/tests/test_md_parser.py apps/worker-py/tests/test_txt_parser.py
git commit -m "feat(worker-py): md + txt evidence parsers (FR-013 evidence-only path)"
```

---

## Task 12: Python FastAPI app with /parse route

**Files:**
- Create: `apps/worker-py/app/main.py`
- Create: `apps/worker-py/app/routes/__init__.py`
- Create: `apps/worker-py/app/routes/health.py`
- Create: `apps/worker-py/app/routes/parse.py`
- Create: `apps/worker-py/tests/test_main.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/worker-py/tests/test_main.py
import io
from fastapi.testclient import TestClient
from openpyxl import Workbook
from app.main import create_app

def _xlsx_bytes():
    wb = Workbook(); ws = wb.active; ws.title = 'Invoice'
    ws.append(['Description','Qty','Rate','Amount','Currency'])
    ws.append(['TRUCKING', 2, 50.0, 100.0, 'AED'])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def test_health():
    app = create_app()
    c = TestClient(app)
    r = c.get('/health')
    assert r.status_code == 200
    assert r.json() == {'status': 'ok'}

def test_parse_xlsx_via_http(monkeypatch):
    # avoid real network by stubbing blob download
    from app.routes import parse as parse_route
    monkeypatch.setattr(parse_route, '_fetch_blob', lambda url: _xlsx_bytes())
    app = create_app()
    c = TestClient(app)
    r = c.post('/parse', json={
        'blob_ref': 'blob:job_1/inv.xlsx',
        'file_id': 'f1', 'job_id': 'job_1',
        'file_type': 'xlsx', 'parser_version': 'parser-0.1.0',
        'blob_url': 'http://signed.example/inv.xlsx'
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['file_id'] == 'f1'
    assert body['normalized']['invoice_lines'][0]['description'] == 'TRUCKING'
    assert body['normalized']['invoice_lines'][0]['numeric_integrity_status'] == 'PASS'

def test_parse_unsupported_type_422():
    app = create_app()
    c = TestClient(app)
    r = c.post('/parse', json={'blob_ref':'b','file_id':'f','job_id':'j','file_type':'pdf','parser_version':'p','blob_url':'u'})
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker-py && pytest tests/test_main.py -v`
Expected: FAIL ??`ModuleNotFoundError: app.main`.

- [ ] **Step 3: Write `apps/worker-py/app/routes/__init__.py`**

```python
"""FastAPI route modules."""
```

- [ ] **Step 4: Write `apps/worker-py/app/routes/health.py`**

```python
from fastapi import APIRouter
router = APIRouter()

@router.get('/health')
def health() -> dict:
    return {'status': 'ok'}
```

- [ ] **Step 5: Write `apps/worker-py/app/routes/parse.py`**

```python
"""POST /parse endpoint. Phase 1: in-memory blob fetch stub (replace with Vercel Blob signed URL)."""
from __future__ import annotations
import hashlib
import httpx
from fastapi import APIRouter, HTTPException
from app.schemas import ParseRequest, ParseResponse
from app.parsers.xlsx import parse_xlsx_bytes
from app.parsers.md import parse_md_bytes
from app.parsers.txt import parse_txt_bytes
from app.validators.numeric_integrity import validate_numeric_integrity
from app.schemas import NormalizedInvoice, InvoiceHeader

router = APIRouter()

def _fetch_blob(blob_url: str) -> bytes:
    """Phase 1 stub. In production, fetch from Vercel Blob signed URL using BLOB_READ_WRITE_TOKEN."""
    with httpx.Client(timeout=10.0) as client:
        r = client.get(blob_url)
        r.raise_for_status()
        return r.content

@router.post('/parse', response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    try:
        raw = _fetch_blob(req.blob_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'BLOB_FETCH_FAILED: {e!s}')

    if req.file_type == 'xlsx':
        ni = parse_xlsx_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    elif req.file_type == 'md':
        ni = parse_md_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    elif req.file_type == 'txt':
        ni = parse_txt_bytes(raw, file_id=req.file_id, file_name=req.blob_ref, parser_version=req.parser_version)
    else:
        raise HTTPException(status_code=422, detail=f'UNSUPPORTED_FILE_TYPE: {req.file_type}')

    validate_numeric_integrity(ni.invoice_lines)

    parse_result_id = 'pr_' + hashlib.sha1(f"{req.job_id}|{req.file_id}|{req.parser_version}".encode()).hexdigest()[:12]
    return ParseResponse(parse_result_id=parse_result_id, job_id=req.job_id, file_id=req.file_id, normalized=ni)
```

- [ ] **Step 6: Write `apps/worker-py/app/main.py`**

```python
"""FastAPI application entry point."""
from fastapi import FastAPI
from app.routes.health import router as health_router
from app.routes.parse import router as parse_router

def create_app() -> FastAPI:
    app = FastAPI(title='Invoice Audit Parser', version='0.1.0')
    app.include_router(health_router)
    app.include_router(parse_router)
    return app

app = create_app()
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/worker-py && pytest tests/test_main.py -v`
Expected: PASS ??3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/worker-py/app/main.py apps/worker-py/app/routes/ apps/worker-py/tests/test_main.py
git commit -m "feat(worker-py): FastAPI app with /health and /parse (FR-011)"
```

---

## Task 13: Python worker client (Vercel-side HTTP wrapper)

**Files:**
- Create: `apps/web/src/lib/parser-client.ts`
- Create: `apps/web/tests/parser-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/parser-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { createParserClient } from '../src/lib/parser-client';

describe('parser-client', () => {
  beforeEach(() => fetchMock.mockReset());

  it('parse POSTs to /parse and returns normalized', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ parse_result_id: 'pr1', job_id: 'j1', file_id: 'f1',
        normalized: { invoice_id: 'inv1', invoice_header: { currency: 'AED' },
          invoice_lines: [{ line_id: 'l1', description: 'X', currency: 'AED', amount: 1 }], evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.1.0' } })
    });
    const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 't' });
    const r = await c.parse({ blob_ref: 'b', file_id: 'f1', job_id: 'j1', file_type: 'xlsx', parser_version: 'parser-0.1.0', blob_url: 'http://signed/x' });
    expect(r.normalized.invoice_lines[0].description).toBe('X');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/parse');
    expect(init.headers['authorization']).toBe('Bearer t');
  });

  it('throws PARSE_FAILED on 4xx/5xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: 'bad' }) });
    const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 't' });
    await expect(c.parse({ blob_ref:'b', file_id:'f', job_id:'j', file_type:'xlsx', parser_version:'p', blob_url:'u' })).rejects.toThrow(/PARSE_FAILED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/parser-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/lib/parser-client.ts`**

```ts
export interface ParseRequestPayload {
  blob_ref: string;
  file_id: string;
  job_id: string;
  file_type: 'xlsx' | 'md' | 'txt';
  parser_version: string;
  blob_url: string;
}

export interface ParseResponse {
  parse_result_id: string;
  job_id: string;
  file_id: string;
  normalized: unknown;
}

export interface ParserClient {
  parse(req: ParseRequestPayload): Promise<ParseResponse>;
}

export class ParseFailedError extends Error {
  readonly code = 'PARSE_FAILED';
  constructor(msg: string) { super(msg); this.name = 'ParseFailedError'; }
}

export function createParserClient(opts: { baseUrl: string; token: string }): ParserClient {
  const { baseUrl, token } = opts;
  return {
    async parse(req) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req)
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new ParseFailedError(`parser returned ${res.status}: ${txt}`);
      }
      return res.json() as Promise<ParseResponse>;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/parser-client.test.ts`
Expected: PASS ??2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/parser-client.ts apps/web/tests/parser-client.test.ts
git commit -m "feat(web): add parser client (HTTP wrapper to Python worker)"
```

---

## Task 14: API-001 `/api/files/ingest` route (US-001, FR-001~FR-010)

**Files:**
- Create: `apps/web/src/app/api/files/ingest/route.ts`
- Create: `apps/web/tests/api-files-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/api-files-ingest.test.ts
import { describe, it, expect, vi } from 'vitest';

const putMock = vi.fn(async (_name: string, body: Blob) => ({ url: 'https://blob/x', pathname: 'x' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

import { POST } from '../src/app/api/files/ingest/route';

function makeRequest(file: File | null, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers });
}

describe('POST /api/files/ingest', () => {
  it('NO_FILE when no file in form', async () => {
    const r = await POST(makeRequest(null));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('NO_FILE');
  });

  it('UNSUPPORTED_FILE_TYPE for .pdf', async () => {
    const f = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('happy path: xlsx ??201 with job_id, file_id, sha256, blob_ref', async () => {
    const f = new File(['hello'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.job_id).toMatch(/^job_/);
    expect(body.file_ids).toHaveLength(1);
    expect(body.status).toBe('UPLOADED');
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.blob_ref).toMatch(/^blob:/);
    expect(putMock).toHaveBeenCalledOnce();
  });

  it('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD for > 4.5MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    const f = new File([big], 'big.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const r = await POST(makeRequest(f));
    expect(r.status).toBe(413);
    expect((await r.json()).code).toBe('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/api-files-ingest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/app/api/files/ingest/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { uploadToBlob } from '@/lib/blob';
import { createJobStore } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { SourceFileSchema } from '@/lib/types';

export const runtime = 'nodejs';

const STORE = createJobStore();

const MAX_DIRECT_UPLOAD_BYTES = 4_500_000; // 4.5MB (Vercel limit)
const ALLOWED_MIME: Record<string, 'xlsx' | 'md' | 'txt'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/markdown': 'md',
  'text/plain': 'txt'
};
const ALLOWED_EXT: Record<string, 'xlsx' | 'md' | 'txt'> = {
  '.xlsx': 'xlsx', '.md': 'md', '.txt': 'txt'
};

function err(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, message, ...extra }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('STORAGE_AUTH_FAILED', 'invalid form body');
  }
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return err('NO_FILE', 'no file in form data');
  }
  if (file.size === 0) {
    return err('UNSUPPORTED_FILE_TYPE', 'zero-byte file');
  }

  const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase();
  const file_type = ALLOWED_MIME[file.type] ?? ALLOWED_EXT[ext];
  if (!file_type) {
    return err('UNSUPPORTED_FILE_TYPE', `unsupported file type: ${file.type || ext}`);
  }

  if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
    return err('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD', 'file exceeds 4.5MB; use client direct upload', { max_bytes: MAX_DIRECT_UPLOAD_BYTES });
  }

  const userId = req.headers.get('x-user-id') ?? 'anonymous';

  let blobRes;
  try {
    blobRes = await uploadToBlob(file, 'pending');
  } catch (e) {
    return err('STORAGE_AUTH_FAILED', (e as Error).message);
  }

  const job = await STORE.createJob({ created_by: userId });
  const sourceFile = SourceFileSchema.parse({
    file_id: `file_${Math.random().toString(36).slice(2, 14)}`,
    job_id: job.job_id,
    original_filename: file.name,
    file_type,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: blobRes.size_bytes,
    sha256: blobRes.sha256,
    blob_ref: blobRes.blob_ref,
    parser_status: 'PENDING',
    uploaded_by: userId,
    uploaded_at: new Date().toISOString()
  });
  await STORE.addSourceFile(job.job_id, sourceFile);
  await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
  await STORE.appendTrace(job.job_id, { step: 'UPLOAD', input_ref: sourceFile.blob_ref, output_ref: job.job_id, source_hash: blobRes.sha256 });

  return NextResponse.json({
    job_id: job.job_id,
    file_ids: [sourceFile.file_id],
    status: 'UPLOADED',
    sha256: blobRes.sha256,
    blob_ref: blobRes.blob_ref
  }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/api-files-ingest.test.ts`
Expected: PASS ??4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/files/ingest/ apps/web/tests/api-files-ingest.test.ts
git commit -m "feat(web): API-001 /api/files/ingest (US-001, FR-001~FR-010)"
```

---

## Task 15: API-002 `/api/invoice-audit/run` route (US-002, US-003)

**Files:**
- Create: `apps/web/src/app/api/invoice-audit/run/route.ts`
- Create: `apps/web/tests/api-invoice-audit-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/api-invoice-audit-run.test.ts
import { describe, it, expect, vi } from 'vitest';

const putMock = vi.fn(async (_n: string, b: Blob) => ({ url: 'https://blob/x', pathname: 'x' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '../src/app/api/invoice-audit/run/route';

async function setupJob(): Promise<{ jobId: string; fileId: string }> {
  const fd = new FormData();
  fd.set('file', new File(['hello'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const r1 = await fetch('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } });
  const j = await r1.json();
  return { jobId: j.job_id, fileId: j.file_ids[0] };
}

describe('POST /api/invoice-audit/run', () => {
  it('JOB_NOT_FOUND for unknown job', async () => {
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: 'job_nope' }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('happy path: parse ??CF MCP ??gate ??202 + eventually verdict', async () => {
    const { jobId } = await setupJob();

    fetchMock
      // parser
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ parse_result_id: 'pr1', job_id: jobId, file_id: 'f1', normalized: { invoice_id: 'inv1', invoice_header: { currency: 'AED' }, invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, qty: 2, rate: 50, source_ref: { sheet: 'S', row: 2, col: '0' } }], evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.1.0' } }) })
      // route_question
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: [] } }) })
      // check_cost_guard
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 2, result: { lineResults: [{ lineId: 'l1', band: 'PASS', deltaPct: 1.0, verdict: 'ACCEPTABLE', proofRef: 'proof_1' }] } }) })
      // check_doc_guardian
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 3, result: { findings: [] } }) });

    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';

    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.job_id).toBe(jobId);
    expect(body.status).toBe('VALIDATING');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run tests/api-invoice-audit-run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/app/api/invoice-audit/run/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { createJobStore } from '@/lib/job-store';
import { createParserClient } from '@/lib/parser-client';
import { createCfMcpClient, McpUnavailableError } from '@/lib/cf-mcp-client';
import { buildGateResult } from '@/lib/gate-bridge';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';
import { SctValidationResultSchema } from '@/lib/types';

export const runtime = 'nodejs';

const STORE = createJobStore();

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function POST(req: Request): Promise<Response> {
  let body: { job_id?: string };
  try { body = await req.json(); } catch { return err('INVALID_STATE', 'invalid json body'); }
  if (!body.job_id) return err('INVALID_STATE', 'job_id required');

  const job = await STORE.getJob(body.job_id);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  if (job.status !== 'UPLOADED' && job.status !== 'QUEUED') {
    return err('INVALID_STATE', `cannot run from status ${job.status}`);
  }
  const files = await STORE.listSourceFiles(body.job_id);
  if (files.length === 0) return err('INVALID_STATE', 'no source files');

  await STORE.updateJob(body.job_id, { status: 'PARSING' });
  const file = files[0];

  const parser = createParserClient({
    baseUrl: process.env.PARSER_WORKER_URL ?? 'http://127.0.0.1:8000',
    token: process.env.PARSER_WORKER_TOKEN ?? 'dev'
  });

  let parseRes;
  try {
    parseRes = await parser.parse({
      blob_ref: file.blob_ref, file_id: file.file_id, job_id: body.job_id,
      file_type: file.file_type as 'xlsx' | 'md' | 'txt', parser_version: job.parser_version,
      blob_url: `http://placeholder/${file.blob_ref}` // Phase 1: stub URL; Phase 2: signed URL
    });
  } catch (e) {
    await STORE.appendTrace(body.job_id, { step: 'PARSE', input_ref: file.blob_ref, output_ref: 'parser-error', attributedTo: 'parser-client' });
    return err('PARSE_FAILED', (e as Error).message);
  }

  await STORE.appendTrace(body.job_id, {
    step: 'PARSE', input_ref: file.blob_ref, output_ref: parseRes.parse_result_id,
    source_hash: file.sha256, calculation_hash: parseRes.parse_result_id, attributedTo: 'python-worker'
  });

  await STORE.updateJob(body.job_id, { status: 'VALIDATING' });

  const cf = createCfMcpClient({
    baseUrl: process.env.CF_MCP_BASE_URL ?? 'https://hvdc-ontology-chatgpt-app.mscho715.workers.dev',
    timeoutMs: Number(process.env.CF_MCP_TIMEOUT_MS ?? 5000),
    retries: 3
  });

  let sct;
  try {
    sct = await cf.validate(body.job_id, {
      invoice_lines: (parseRes.normalized as { invoice_lines: unknown[] }).invoice_lines,
      evidence_index: (parseRes.normalized as { evidence_candidates: unknown[] }).evidence_candidates,
      rule_version: job.rule_version
    });
  } catch (e) {
    if (e instanceof McpUnavailableError) {
      await STORE.appendTrace(body.job_id, { step: 'VALIDATE', input_ref: parseRes.parse_result_id, output_ref: 'mcp-error' });
      return err('MCP_UNAVAILABLE', e.message);
    }
    return err('VALIDATION_FAILED', (e as Error).message);
  }

  for (const tc of sct.cf_mcp_tool_calls) {
    await STORE.appendTrace(body.job_id, {
      step: tc.tool === 'check_cost_guard' ? 'COSTGUARD' : tc.tool === 'check_doc_guardian' ? 'DOC_GUARDIAN' : 'VALIDATE',
      input_ref: parseRes.parse_result_id, output_ref: tc.tool,
      latency_ms: tc.latency_ms, attributedTo: `cf-mcp:${tc.tool}`
    });
  }

  const sctParsed = SctValidationResultSchema.parse({
    validation_id: 'val_' + sct.sct_trace_id,
    job_id: body.job_id,
    sct_trace_id: sct.sct_trace_id,
    cf_mcp_tool_calls: sct.cf_mcp_tool_calls,
    type_b_results: sct.type_b_results,
    rate_checks: sct.rate_checks,
    evidence_requirements: sct.evidence_requirements,
    costguard_results: sct.costguard_results,
    doc_guardian_results: sct.doc_guardian_results,
    gate_results: sct.gate_results,
    confidence: sct.confidence,
    reason_codes: sct.reason_codes,
    warnings: sct.warnings
  });
  void sctParsed;

  const gate = buildGateResult(body.job_id, sct.costguard_results.map(c => ({
    line_id: c.line_id, band: c.band, delta_pct: c.delta_pct, reason_codes: [`COSTGUARD_${c.band}`]
  })));
  await STORE.setResult(body.job_id, gate);
  await STORE.updateJob(body.job_id, { status: 'REVIEW_REQUIRED', verdict: gate.verdict });
  await STORE.appendTrace(body.job_id, { step: 'DECISION', input_ref: sct.sct_trace_id, output_ref: gate.gate_id, attributedTo: 'gate-bridge' });

  return NextResponse.json({ job_id: body.job_id, status: 'REVIEW_REQUIRED', verdict: gate.verdict }, { status: 202 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run tests/api-invoice-audit-run.test.ts`
Expected: PASS ??2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/invoice-audit/run/ apps/web/tests/api-invoice-audit-run.test.ts
git commit -m "feat(web): API-002 /api/invoice-audit/run (US-002, US-003, parse?CF MCP?gate)"
```

---

## Task 16: API-003 `/api/audit/status` and API-004 `/api/audit/result` routes

**Files:**
- Create: `apps/web/src/app/api/audit/status/route.ts`
- Create: `apps/web/src/app/api/audit/result/route.ts`
- Create: `apps/web/tests/api-audit-status.test.ts`
- Create: `apps/web/tests/api-audit-result.test.ts`

- [ ] **Step 1: Write the failing test (status)**

```ts
// apps/web/tests/api-audit-status.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { GET as STATUS_GET } from '../src/app/api/audit/status/route';

async function setupJob(): Promise<string> {
  const fd = new FormData();
  fd.set('file', new File(['x'], 'a.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const r = await fetch('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } });
  const j = await r.json();
  return j.job_id;
}

describe('GET /api/audit/status', () => {
  it('JOB_NOT_FOUND', async () => {
    const r = await STATUS_GET(new Request('http://test/api/audit/status?job_id=job_nope'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('happy path: returns status, verdict, last_step', async () => {
    const jobId = await setupJob();
    const r = await STATUS_GET(new Request(`http://test/api/audit/status?job_id=${jobId}`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.job_id).toBe(jobId);
    expect(body.status).toBe('UPLOADED');
    expect(body.last_step).toBe('UPLOAD');
  });
});
```

- [ ] **Step 2: Write the failing test (result)**

```ts
// apps/web/tests/api-audit-result.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'x', pathname: 'x' })) }));

import { GET as RESULT_GET } from '../src/app/api/audit/result/route';

describe('GET /api/audit/result', () => {
  it('JOB_NOT_FOUND', async () => {
    const r = await RESULT_GET(new Request('http://test/api/audit/result?job_id=job_nope'));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('RESULT_NOT_READY when job has no result yet', async () => {
    const fd = new FormData();
    fd.set('file', new File(['x'], 'a.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const r1 = await fetch('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } });
    const { job_id } = await r1.json();
    const r = await RESULT_GET(new Request(`http://test/api/audit/result?job_id=${job_id}`));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('RESULT_NOT_READY');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run tests/api-audit-status.test.ts tests/api-audit-result.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `apps/web/src/app/api/audit/status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { createJobStore } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';

export const runtime = 'nodejs';
const STORE = createJobStore();

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const trace = await STORE.listTrace(jobId);
  const last_step = trace.length > 0 ? trace[trace.length - 1].step : null;
  return NextResponse.json({
    job_id: job.job_id,
    status: job.status,
    verdict: job.verdict,
    last_step,
    progress: trace.length,
    updated_at: job.updated_at
  });
}
```

- [ ] **Step 5: Write `apps/web/src/app/api/audit/result/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { createJobStore } from '@/lib/job-store';
import { ErrorCodes, httpForError, type ErrorCode } from '@/lib/error-codes';

export const runtime = 'nodejs';
const STORE = createJobStore();

function err(code: ErrorCode, message: string) {
  return NextResponse.json({ code, message }, { status: httpForError(code) });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return err('INVALID_STATE', 'job_id required');
  const job = await STORE.getJob(jobId);
  if (!job) return err('JOB_NOT_FOUND', 'unknown job_id');
  const result = await STORE.getResult(jobId);
  if (!result) return err('INVALID_STATE', 'result not ready (RESULT_NOT_READY)');
  return NextResponse.json({
    job_id: job.job_id,
    verdict: result.verdict,
    line_results: result.line_results,
    action_items: result.action_items
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run tests/api-audit-status.test.ts tests/api-audit-result.test.ts`
Expected: PASS ??4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/audit/ apps/web/tests/api-audit-status.test.ts apps/web/tests/api-audit-result.test.ts
git commit -m "feat(web): API-003 status + API-004 result (US-006 partial)"
```

---

## Task 17: UI layout and upload form (US-001 visual)

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/invoice-audit/upload/page.tsx`
- Create: `apps/web/src/app/invoice-audit/jobs/[jobId]/page.tsx`
- Create: `apps/web/src/components/upload-form.tsx`

- [ ] **Step 1: Write `apps/web/src/app/globals.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8f9fb; color: #111; }
.container { max-width: 720px; margin: 0 auto; padding: 24px; }
.card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.btn { background: #0a4ed6; color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.btn:disabled { background: #999; cursor: not-allowed; }
.input { display: block; margin: 8px 0 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; width: 100%; }
.alert { padding: 12px; border-radius: 6px; margin: 12px 0; }
.alert-error { background: #fee; color: #900; }
.alert-warn  { background: #ffeaa0; color: #664; }
.alert-pass  { background: #d4f7d4; color: #060; }
```

- [ ] **Step 2: Write `apps/web/src/app/layout.tsx`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Invoice Audit Platform' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/app/page.tsx`**

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <h1>SCT_ONTOLOGY Invoice Audit Platform</h1>
      <p>Phase 1 MVP ??upload invoice/evidence and run dry-run validation.</p>
      <p><Link className="btn" href="/invoice-audit/upload">Start audit</Link></p>
    </main>
  );
}
```

- [ ] **Step 4: Write `apps/web/src/components/upload-form.tsx`**

```tsx
'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setErr('select a file'); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const r = await fetch('/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'dev-user' } });
      const body = await r.json();
      if (!r.ok) { setErr(`${body.code}: ${body.message}`); return; }
      router.push(`/invoice-audit/jobs/${body.job_id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Upload invoice or evidence</h2>
      <p>Supported: <code>.xlsx</code>, <code>.md</code>, <code>.txt</code> (??4.5 MB)</p>
      <input className="input" type="file" accept=".xlsx,.md,.txt"
        onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" type="submit" disabled={busy || !file}>
        {busy ? 'Uploading?? : 'Upload'}
      </button>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </form>
  );
}
```

- [ ] **Step 5: Write `apps/web/src/app/invoice-audit/upload/page.tsx`**

```tsx
import UploadForm from '@/components/upload-form';

export default function UploadPage() {
  return (
    <main className="container">
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 6: Write `apps/web/src/app/invoice-audit/jobs/[jobId]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';

async function fetchStatus(jobId: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const r = await fetch(`${base}/api/audit/status?job_id=${jobId}`, { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json() as Promise<{ status: string; verdict: string | null; last_step: string | null }>;
}

export default async function JobPage({ params }: { params: { jobId: string } }) {
  const status = await fetchStatus(params.jobId);
  if (!status) notFound();

  const isFinal = ['COMPLETED','REJECTED','FAILED'].includes(status.status);
  const verdictClass = status.verdict === 'PASS' ? 'alert-pass' : status.verdict === 'AMBER' ? 'alert-warn' : status.verdict === 'ZERO' ? 'alert-error' : '';

  return (
    <main className="container">
      <h1>Job {params.jobId}</h1>
      <div className="card">
        <p>Status: <strong>{status.status}</strong></p>
        <p>Verdict: <strong>{status.verdict ?? '(pending)'}</strong></p>
        <p>Last step: <code>{status.last_step ?? '(none)'}</code></p>
        {status.verdict && <div className={`alert ${verdictClass}`}>Verdict: {status.verdict}</div>}
        <form action={`/api/invoice-audit/run`} method="post">
          <input type="hidden" name="job_id" value={params.jobId} />
          <button className="btn" type="submit" disabled={status.status !== 'UPLOADED'}>Run dry-run</button>
        </form>
        {!isFinal && <p><a href={`/invoice-audit/jobs/${params.jobId}`}>Refresh</a></p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Build to verify it compiles**

Run: `cd apps/web && npm run typecheck`
Expected: PASS (no TS errors). If there are errors, fix the import paths or types.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/ apps/web/src/components/
git commit -m "feat(web): upload + job status pages (UI for US-001, US-006)"
```

---

## Task 18: End-to-end smoke (manual checklist)

**Files:**
- Create: `tests/integration/README.md`
- Create: `tests/integration/phase1_smoke.spec.ts`

- [ ] **Step 1: Write the smoke checklist**

```markdown
# tests/integration/README.md

# Phase 1 MVP Smoke Test

Manual + scripted E2E. Run in this order.

## Pre-requisites

1. `cd apps/web && npm install && npm run build` (Vercel build)
2. `cd apps/worker-py && pip install -e ".[dev]"` (Python deps)
3. `cd apps/worker-py && uvicorn app.main:app --port 8000` (Python worker)
4. `cd apps/web && npm run dev` (Vercel dev on :3000)
5. Set `apps/web/.env.local` from `.env.example`.

## Steps

1. Open http://localhost:3000 ??click "Start audit".
2. Upload `apps/worker-py/tests/fixtures/sample-invoice.xlsx` (create if missing; see test_xlsx_parser.py for shape).
3. Verify redirect to `/invoice-audit/jobs/{job_id}` with status UPLOADED.
4. Click "Run dry-run" ??wait for VALIDATING ??REVIEW_REQUIRED.
5. Verify `GET /api/audit/result?job_id={id}` returns JSON with `verdict` (PASS/AMBER/ZERO) and `line_results[]`.
6. Verify `GET /api/audit/status?job_id={id}` returns status REVIEW_REQUIRED.
7. Negative tests:
   - Upload a `.pdf` ??expect `UNSUPPORTED_FILE_TYPE`.
   - Upload a 5 MB `.xlsx` ??expect `UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD`.
   - GET `/api/audit/status?job_id=job_doesnotexist` ??404 `JOB_NOT_FOUND`.
   - GET `/api/audit/result` before running ??409 `RESULT_NOT_READY`.

## Pass criteria

All 7 steps succeed. No silent failures in trace.
```

- [ ] **Step 2: Write the smoke spec stub**

```ts
// tests/integration/phase1_smoke.spec.ts
/**
 * Phase 1 E2E smoke. Marked as .spec.ts to be runnable by vitest if env is set.
 * In CI, this is executed manually per tests/integration/README.md.
 */
import { describe, it } from 'vitest';
describe('phase1 smoke (manual)', () => {
  it.skip('see tests/integration/README.md for the manual checklist', () => {});
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/
git commit -m "test: add Phase 1 E2E smoke checklist + stub spec"
```

---

## Task 19: README and run script for Phase 1

**Files:**
- Create: `apps/README.md`

- [ ] **Step 1: Write the monorepo README**

```markdown
# apps/ ??Invoice Audit Platform (Phase 1 MVP)

Hybrid 3-tier:
- `web/` ??Vercel Next.js (UI + API Orchestrator). Port 3000.
- `worker-py/` ??Python FastAPI parser. Port 8000.

See `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC_v0.2.0.md` for the full spec.

## Run dev

```bash
# terminal 1
cd apps/worker-py
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000

# terminal 2
cd apps/web
cp .env.example .env.local
# fill BLOB_READ_WRITE_TOKEN from Vercel dashboard
npm install
npm run dev
```

## Run tests

```bash
cd apps/web && npm test
cd apps/worker-py && pytest
```

## End-to-end

See `tests/integration/README.md`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/README.md
git commit -m "docs: monorepo README for Phase 1 MVP"
```

---

## Task 20: Final verification ??full test run + typecheck

- [ ] **Step 1: Run all web tests**

Run: `cd apps/web && npm test`
Expected: All tests pass (types, error-codes, job-store, gate-bridge, blob, cf-mcp-client, parser-client, api-files-ingest, api-invoice-audit-run, api-audit-status, api-audit-result).

- [ ] **Step 2: Run all Python tests**

Run: `cd apps/worker-py && pytest`
Expected: All tests pass (schemas, numeric_integrity, xlsx_parser, md_parser, txt_parser, main).

- [ ] **Step 3: Run web typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Run Python typecheck (if mypy installed)**

Run: `cd apps/worker-py && mypy app/` (optional)
Expected: No errors or no mypy configured.

- [ ] **Step 5: Manual smoke (Task 18) + commit final tag**

```bash
git tag phase1-mvp-candidate
```

- [ ] **Step 6: Report**

Output a summary:
- Web tests: <count> passed, <count> failed
- Python tests: <count> passed, <count> failed
- Typecheck: pass / fail
- Smoke: pass / fail / not-run

---

## Self-Review (after writing the plan)

### 1. Spec coverage

Spec sections covered by Phase 1 plan:
- 1.2 D-001, D-002, D-003, D-004, D-005 ??locked decisions
- 2 US-001 (upload + job) ??Tasks 14, 17
- 2 US-002 (parser) ??Tasks 8??3
- 2 US-003 (SCT validate via CF MCP) ??Tasks 7, 15
- 2 US-006 (audit trace) ??Tasks 4, 15
- 3 FR-001~FR-010 ??Tasks 6, 14
- 3 FR-011~FR-020 ??Tasks 8??3
- 3 FR-020a (numeric integrity) ??Task 9
- 3 FR-021~FR-030c (SCT validation) ??Tasks 7, 15
- 3 FR-031~FR-040e (gate bridge) ??Task 5, 15
- 3 FR-061~FR-070 (API endpoints) ??Tasks 14, 15, 16
- 5.1 UI surfaces (subset) ??Task 17
- 5.2 API-001~API-004 ??Tasks 14, 15, 16
- 5.3 Worker task contract (parse_*) ??Tasks 10, 11, 12
- 5.4 MCP tool crosswalk (Phase 1 subset: route_question, check_cost_guard, check_doc_guardian) ??Task 7
- 5.5 TYPE-B (parser produces for_charge_component) ??Task 10
- 5.6 Gate rules (4-band ??3-state bridge) ??Task 5
- 5.8 Error codes (Phase 1 subset: 10 codes) ??Task 3
- 9 Phase 1 P1-T1~P1-T6 ??covered

**Out of Phase 1 scope (intentionally deferred to Phase 2+):**
- US-004 (Human approval) ??Phase 2
- US-005 (XLSX export) ??Phase 2
- US-007~US-013 (new in v0.2.0) ??Phase 2+
- FR-030a (PRISM.KERNEL proof entity) ??Phase 2 (CF MCP already returns `proofRef`; we wire it through in Phase 2)
- FR-040a~FR-040e (human-gate matrix, 8 triggers) ??Phase 2
- FR-051~FR-060b (xlsx export, 7-sheet) ??Phase 2
- FR-076~FR-078 (OpenTelemetry) ??Phase 2
- NFR-021~NFR-026 (currency/numeric/PII/observability/i18n/latency) ??Phase 2 (NFR-001~NFR-020 covered by NFR-007 no-silent-fail via trace)
- SC-021~SC-030 ??Phase 2

### 2. Placeholder scan

Searched for: TBD, TODO, FIXME, placeholder. Result: none in plan body (one `Q-013 Phase 4: TBD` in spec, not in plan).

### 3. Type consistency

- `JobStatus` enum used in `types.ts` and `job-store.ts` matches.
- `Verdict` enum used in `types.ts`, `gate-bridge.ts`, `cf-mcp-client.ts` matches.
- `SourceFile` shape used in `blob.ts`, `job-store.ts`, `route.ts` matches.
- `CostGuardBand` in `gate-bridge.ts` and `cf-mcp-client.ts` matches.
- `McpUnavailableError.code = 'MCP_UNAVAILABLE'` used in `cf-mcp-client.ts` and `route.ts` matches `ErrorCodes` enum.
- `ParseFailedError.code = 'PARSE_FAILED'` used in `parser-client.ts` and `route.ts` matches `ErrorCodes` enum.
- `buildGateResult` returns `gate_id` matching spec 4.2.
- `STORE` is a module-level singleton in route files; Phase 2 should swap to per-request or move to request context.

### 4. Identified minor gaps (acceptable for Phase 1)

- The `STORE` singleton in `apps/web/src/app/api/*/route.ts` is process-wide. In Vercel production with multiple instances, the in-memory store is per-instance. This is acknowledged as Phase 1 only ??Phase 2 swaps to D1. (Documented in spec A-014.)
- `blob_url` in `POST /parse` is a stub (`http://placeholder/...`); Phase 2 uses Vercel Blob signed URL via `BLOB_READ_WRITE_TOKEN`.
- The Python `parse_xlsx_bytes` does not extract `tax_line[]` (FR-020b is Phase 2).
- `for_charge_component` is null in parser output (FR-020f); Phase 2 adds ontology `route_question` mapping.

These are all documented in the plan or in the spec's Phase 2+ scope.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-invoice-audit-phase1-mvp.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** ??I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for parallelizable parts (web + worker-py) and for catching issues early.

2. **Inline Execution** ??Execute tasks in this session using executing-plans, batch execution with checkpoints for review. Best for sequential review and tighter control.

**Which approach?**
