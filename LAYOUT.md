# Repository Layout

```
SCT_ONTOLOGY-main/
├── apps/
│   ├── web/                    # Next.js 15 frontend + API (Vercel)
│   │   ├── src/app/            # App Router pages + API route handlers
│   │   ├── src/app/api/        # 13 API routes (upload, GCS upload, audit, export, fx, mcp)
│   │   ├── src/lib/            # Job store, gate-bridge, cf-mcp-client, parser client, blob, error codes
│   │   │   └── mcp/            # In-process MCP validation tools port
│   │   ├── tests/              # Vitest (30 files, 167 tests)
│   │   └── e2e/                # Playwright smoke tests
│   │
│   ├── worker-py/              # Python FastAPI parser/exporter (Google Cloud Run)
│   │   ├── app/routes/         # /v1/parse, /v1/export, /v1/notebooklm/run, /v1/preflight, /v1/vision/*, /health
│   │   ├── app/parsers/        # xlsx (+ DSV summary-matrix decomposition), md, txt, pdf, pdf_json, DSV waybill
│   │   ├── app/services/       # vision_client (stub), vision_normalizer
│   │   ├── app/validators/     # numeric_integrity (PASS/AMBER)
│   │   ├── app/middleware/     # Audit log middleware (FR-025)
│   │   ├── app/notebooklm/     # MarkItDown → NotebookLM orchestrator + MCP client
│   │   ├── app/exporters/      # 13-sheet workbook export logic
│   │   └── tests/              # Pytest (165 tests)
│   │
│   └── mcp-server/             # Hono MCP validation server (Google Cloud Run, standalone)
│       ├── src/tools/          # Re-exports 14 validation tools from @invoice-audit/tools
│       ├── src/schemas/        # validation schemas (incl. dlp-guard.ts)
│       └── db/                 # Rate card migrations + seeds
│
├── packages/
│   ├── tools/                  # @invoice-audit/tools — 14 MCP tools, single source of truth
│   │   └── src/                # route_question, normalize_invoice_lines, check_duplicate_invoice,
│   │                           #   match_shipment_reference, check_rate_card (+ batch),
│   │                           #   check_contract_validity, check_evidence_required,
│   │                           #   check_tax_vat, check_fx_policy, check_cost_guard,
│   │                           #   build_validation_explanation, classify_type_b,
│   │                           #   check_hs_uae_compliance, check_dem_det, types, index
│   ├── database/               # @invoice-audit/database — Postgres pool singleton (Neon)
│   │   └── src/index.ts        # Pool factory shared by web + mcp-server
│   ├── contracts/              # Shared Zod schemas (invoice, validation, export)
│   ├── shared/                 # Hash, redaction helpers
│   └── telemetry/              # @invoice-audit/telemetry — OpenTelemetry helpers
│
├── migrations/                 # Neon Postgres DDL
│   ├── 0008_invoice_audit.sql
│   ├── 0009_job_store_persist.sql
│   ├── 0010_invoices.sql
│   ├── 0011_notebooklm_audit_trace.sql
│   └── 0012_extraction_artifacts.sql
│
├── docs/                       # Architecture, layout, plan, security, QA, specs
├── scripts/                    # Utility scripts (audit, seed, graph, scans, deployment)
├── shpiment/                   # DSV shipment reference data (P2, gitignored)
├── domestic/                   # Korean domestic invoice runtime
│
├── .github/workflows/          # CI/CD workflows
│   ├── codeql.yml
│   ├── python-worker-ci.yml
│   ├── release-gate.yml
│   ├── reliability.yml
│   ├── secret-scan.yml
│   ├── vercel-preview.yml
│   ├── vercel-prod.yml
│   └── web-ci.yml
│
├── .env.example                # Environment variable template
├── pnpm-workspace.yaml         # pnpm workspace config
├── tsconfig.base.json          # Shared TypeScript config
├── CLAUDE.md                   # Project rules (Rule #0, architecture, constraints)
├── AGENTS.md                   # Agent operating rules
├── CHANGELOG.md                # Full change history
├── SYSTEM_ARCHITECTURE.md      # Architecture reference
└── README.md                   # Project overview + quick start
```

## Directory Responsibilities

| Path | Responsibility |
|---|---|
| `apps/web/` | Next.js web UI + API orchestration — upload, audit job lifecycle, approval gates, export dispatch, NotebookLM callback |
| `apps/web/src/app/` | App Router pages and API route handlers |
| `apps/web/src/lib/` | Runtime logic: job store, gate-bridge, cf-mcp-client (14-tool in-process orchestration), parser client, blob, FX check, approval gate, export store, error codes, types |
| `apps/web/tests/` | Vitest coverage for API routes, gate logic, and runtime helpers |
| `apps/web/e2e/` | Playwright smoke tests |
| `apps/worker-py/app/routes/` | FastAPI route handlers: parse, export, notebooklm, vision/preflight, health |
| `apps/worker-py/app/parsers/` | File parsers: xlsx (auto-detects DSV summary-matrix layout → charge-level line decomposition), md, txt, pdf (text), pdf_json (OpenDataLoader), DSV waybill |
| `apps/worker-py/app/services/` | Google Vision client (stub) + OCR-JSON normalizer (flag-gated) |
| `apps/worker-py/app/validators/` | `numeric_integrity` — line-level `qty × rate = amount` (PASS/AMBER) |
| `apps/worker-py/app/notebooklm/` | MarkItDown → NotebookLM orchestrator + MCP client (SSRF-guarded) |
| `apps/worker-py/app/exporters/` | 13-sheet contract-compliant audit workbook export |
| `apps/worker-py/tests/` | Pytest coverage with parser/export/vision fixtures |
| `apps/mcp-server/src/tools/` | Re-exports 14 MCP validation tools from `@invoice-audit/tools` (per-tool tests) |
| `apps/mcp-server/src/schemas/` | Validation contracts (includes `dlp-guard.ts`) |
| `apps/mcp-server/db/` | Rate card DDL migrations + seed data |
| `packages/tools/src/` | **14 MCP validation tools — single source of truth** (shared by web + mcp-server) |
| `packages/database/src/index.ts` | Postgres pool singleton (Neon) shared by web + mcp-server |
| `packages/contracts/` | Shared invoice, validation, and export Zod schemas |
| `packages/shared/` | Hashing and redaction helpers shared across TypeScript runtimes |
| `packages/telemetry/` | OpenTelemetry helpers used by web + mcp-server |
| `migrations/` | Neon Postgres schema migrations (`0008`–`0012`) |
| `scripts/` | Audit graphs, source/PII scans, seed/reconcile, deployment, smoke tests, graph build, index drift checks |
| `docs/` | Architecture, layout, plan, security, QA, operations, specs |
| `.github/workflows/` | CI/CD workflows covering web, worker, mcp-server, release gates, code scanning |

## Web Routes (apps/web/src/app/)

| Route | Source | Purpose |
|---|---|---|
| `/` | `page.tsx` | App entry |
| `/invoice-audit` | `invoice-audit/page.tsx` | Audit workspace |
| `/invoice-audit/upload` | `invoice-audit/upload/page.tsx` | Invoice/evidence upload |
| `/invoice-audit/jobs/[jobId]` | `invoice-audit/jobs/[jobId]/page.tsx` | Job detail + review |
| `/fx-policies` | `fx-policies/page.tsx` | FX policy reference |

## API Routes (apps/web/src/app/api/) — 13 routes

| Route | Source | Method |
|---|---|---|
| `/api/files/ingest` | `files/ingest/route.ts` | POST |
| `/api/files/ingest/large` | `files/ingest/large/route.ts` | POST |
| `/api/files/create-upload-url` | `files/create-upload-url/route.ts` | POST |
| `/api/files/confirm` | `files/confirm/route.ts` | POST |
| `/api/invoice-audit/run` | `invoice-audit/run/route.ts` | POST |
| `/api/audit/status` | `audit/status/route.ts` | GET |
| `/api/audit/trace` | `audit/trace/route.ts` | GET |
| `/api/audit/result` | `audit/result/route.ts` | GET |
| `/api/audit/approve` | `audit/approve/route.ts` | POST |
| `/api/audit/export` | `audit/export/route.ts` | POST |
| `/api/export/download` | `export/download/route.ts` | GET |
| `/api/fx-policy` | `fx-policy/route.ts` | POST |
| `/mcp` | `mcp/route.ts` | POST |

> `create-upload-url` and `confirm` are the flag-gated GCS direct-upload path (dev-stub local URL
> until GCS is configured); both export `runtime = 'nodejs'`. New error codes: `INVALID_REQUEST`
> (400), `CONFIRM_FAILED` (500).

## MCP Validation Tools

**Canonical source:** `packages/tools/src/` — 14 tools as single source of truth, imported by both
`apps/web` (in-process, via `cf-mcp-client.ts`) and `apps/mcp-server` (JSON-RPC).

14 tools: `route_question`, `normalize_invoice_lines`, `check_duplicate_invoice`,
`match_shipment_reference`, `check_rate_card` (with `check_rate_card_batch` for N-line batch queries),
`check_contract_validity`, `check_evidence_required`, `check_tax_vat`, `check_fx_policy`,
`check_cost_guard`, `build_validation_explanation`, `classify_type_b`, `check_hs_uae_compliance`,
`check_dem_det`.

## Worker Routes (apps/worker-py/app/routes/)

| Route | Source | Purpose |
|---|---|---|
| `POST /v1/parse` | `parse.py` | Parse uploaded file (aliases: `/parse` deprecated, `/parse/pdf-json`) |
| `POST /v1/export` | `export.py` | Build 13-sheet audit workbook |
| `POST /v1/notebooklm/run` | `notebooklm.py` | MarkItDown → NotebookLM first-pass orchestrator |
| `POST /v1/preflight` | `vision.py` | Classify PDF (text/scanned/encrypted) *(flag-gated)* |
| `POST /v1/vision/start` | `vision.py` | Start Google Vision async OCR *(stub until `VISION_ENABLED`)* |
| `POST /v1/vision/collect` | `vision.py` | Collect Vision OCR result *(stub)* |
| `GET /health/ready` | `health.py` | Readiness check |
| `GET /health/live` | `health.py` | Liveness check |

> Router mounting (`app/main.py`): `parse`/`health` at root; `export` and `notebooklm` under `/v1`;
> `vision` with empty prefix (its paths already carry `/v1/`).

## Extraction Artifacts (migration 0012)

| Table | Purpose |
|---|---|
| `extraction_artifacts` | Per-engine (pdfplumber/google_vision/markitdown/notebooklm) extraction results — sha256, confidence, GCS URI. No raw text. |
| `extraction_comparisons` | Pairwise field comparison between engines — MATCH/MISMATCH/MISSING/LOW_CONFIDENCE, PASS/AMBER/ZERO/FAILED severity, hash-only values. |

Indexes: `idx_extraction_artifacts_job_id`, `idx_extraction_artifacts_file_id`,
`idx_extraction_comparisons_job_id`.

## Local/Generated Directories (gitignored)

- `apps/web/.next/`, `.dev-blob/`, `coverage/`, `test-results/`, `node_modules/`
- `apps/worker-py/.venv/`, `.pytest_cache/`, `__pycache__/`
- `apps/mcp-server/node_modules/`, `dist/`
- `.vercel/`, `.codex/`, `.claude/`, `graphify-out/`

Do not copy generated invoice text, signed URLs, blob keys, or sensitive evidence from these into documentation.

## Verification Commands

| Area | Command |
|---|---|
| Web typecheck | `pnpm --dir apps/web typecheck` |
| Web tests | `pnpm --dir apps/web test` (167) |
| Web build | `pnpm --dir apps/web build` |
| Worker tests | `cd apps/worker-py && pytest -q` (165) |
| Worker syntax | `python -m py_compile apps/worker-py/app/routes/parse.py` |
| MCP typecheck | `cd apps/mcp-server && pnpm typecheck` |
| MCP tests | `cd apps/mcp-server && pnpm test` (186) |
| MCP build | `cd apps/mcp-server && pnpm build` |
| Workbook contract | `python apps/worker-py/scripts/workbook_contract_validate.py <wb.xlsx>` |

## History

Earlier the repository ran a Cloudflare Worker serving the SCT ontology ChatGPT App (`server/src/`,
`public/`, `data/corpus/`, `wh status/`, root `tests/`, D1 migrations `0001-0007`). That runtime was
deleted and replaced by the current invoice audit platform; D1 migrations are kept for reference only,
superseded by Postgres `0008`–`0012`. Full change history: [`CHANGELOG.md`](./CHANGELOG.md). See
[`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) for the full architecture.
