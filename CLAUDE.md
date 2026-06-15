# SCT Invoice Audit Platform

3-app architecture for HVDC invoice processing + cost guard + approval gates.
Samsung C&T HVDC Abu Dhabi project. ADNOC/DSV partnership.

## DLP 정책 (2026-06-15 추가)

**DLP는 시스템에 추가하지 않음** — 새로운 DLP(Data Loss Prevention) 기능·모듈·도구를 시스템에 추가하지 않음. 기존 P2 DLP 규칙은 2026-06-15에 제거됨.

## Quick Commands

```bash
# Web app (Next.js 15)
cd apps/web && pnpm dev          # localhost:3000
pnpm --dir apps/web typecheck    # 0 errors baseline
pnpm --dir apps/web test         # 157 tests
pnpm --dir apps/web build        # production build

# Python worker (FastAPI)
cd apps/worker-py && uvicorn app.main:app --port 8000
cd apps/worker-py && pytest -q   # 149 tests

# MCP server (Hono, standalone)
cd apps/mcp-server && pnpm dev   # localhost:8080
cd apps/mcp-server && pnpm test  # 186 tests
```

## Architecture

**Canonical role definition:** see `docs/superpowers/specs/2026-06-14-final-role-definition-and-flow.md` (3-layer: NoteLM / Worker / Vercel).

```
apps/web (Next.js, Vercel)
  ├── Upload → Vercel Blob
  ├── API routes orchestrate full audit pipeline
  ├── gate-bridge.ts — PASS/AMBER/ZERO/FAILED verdicts
  ├── workbook-builder.ts — 13-sheet contract assembly
  ├── Imports MCP tools from @invoice-audit/tools (14 tools, single source of truth)
  └── fetch → apps/worker-py for /parse and /v1/export

apps/worker-py (FastAPI, Fly.io)
  ├── /parse — xlsx/md/txt/pdf/pdf_json + DSV waybill
  └── /v1/export — 13-sheet audit workbook

apps/mcp-server (Hono, Fly.io)
  └── Standalone JSON-RPC MCP server for external clients
      (ChatGPT, Claude Desktop). Imports the same @invoice-audit/tools package.
      NOT called during web audit flow.

packages/tools (TypeScript, ESM)
  └── 14 MCP validation tools — single source of truth
      (route_question, normalize_invoice_lines, check_duplicate_invoice,
       match_shipment_reference, check_rate_card [+ check_rate_card_batch],
       check_contract_validity, check_evidence_required, check_tax_vat,
       check_fx_policy, check_cost_guard, build_validation_explanation,
       classify_type_b, check_hs_uae_compliance, check_dem_det)

packages/database (TypeScript, ESM)
  └── Postgres pool singleton (Neon) — shared by web and mcp-server
```

### Architecture Status (2026-06-14 audit)

The implementation mostly matches the spec but with notable deviations:

| Layer | Spec | Actual code | Status |
|---|---|---|---|
| **NoteLM** | field extraction only | `notebooklm-mcp-pr53-pr55` + `apps/mcp-server` | ✅ Compliant |
| **Worker** | MarkItDown → NotebookLM → normalize → callback | `apps/worker-py` | ⚠️ **Exceeds scope** — also does PDF parsing, numeric-integrity validation, contract validation |
| **Vercel** | callback + adapter + final audit + workbook | `apps/web` | ✅ Compliant — final audit engine (`gate-bridge.ts`, `cf-mcp-client.ts`), approval gate, workbook builder, NotebookLM callback receiver all present |

**Nuanced view of Worker responsibilities:**

- `app/notebooklm/orchestrator.py` — matches the spec exactly (MarkItDown → NotebookLM → callback).
- `app/parsers/`, `app/validators/numeric_integrity.py`, `app/scripts/workbook_contract_validate.py` — these compute things the spec says Vercel should compute. **Actual spec violations** when invoked by Vercel.
- `app/exporters/xlsx.py` + `app/routes/export.py` — these are a **simple xlsx formatter** (verdict is passed in via `ExportRequest`, not computed here) and a **microservice endpoint** that Vercel *could* call. The `/v1/export` route is functional and has 5 passing tests. Whether it is the production export path or a legacy/alternative route is unclear. Treat as **allowed microservice** unless production usage is confirmed otherwise.
- `app/middleware/audit_log.py`, `app/schemas.py:103 verdict: str` — verdict appears in the worker's data model because the worker logs verdict events for the audit trail. This is a data layer concern, not a verdict-computation concern.

**Known duplication (verdict logic only):** Verdict PASS/AMBER/ZERO/FINAL logic exists in BOTH `apps/worker-py/validators/numeric_integrity.py` and `apps/web/src/lib/gate-bridge.ts`. The Vercel version is the canonical one (called by Vercel's final audit engine). The worker's `numeric_integrity.py` is line-level integrity (qty × rate = line_amount), not the job-level 3-way reconciliation. The two checks serve different purposes but both produce PASS/AMBER/ZERO semantics.

**Migration status:** Not started. Estimated scope: 2 files (`app/validators/numeric_integrity.py`, `app/scripts/workbook_contract_validate.py`) could be removed once their callers (likely inside the worker's /parse route) are migrated to compute validation in Vercel. The `/v1/export` route and `app/exporters/xlsx.py` should be kept as a microservice until Vercel's direct workbook path is confirmed as the sole production export. See `docs/session-wraps/2026-06-14-notebooklm-ask-question-timeout.md` §5 for follow-up tasks.

When making changes, respect: `Worker = orchestrator only, Vercel = final audit + workbook`. Don't add new validation logic to worker files.

## Database

- **Neon Postgres** (primary): jobs, gate results, invoices, traces, rate cards — via `DATABASE_URL`
- **Vercel Blob** (private): invoice/evidence files, export artifacts — via `BLOB_READ_WRITE_TOKEN`
- **Cloudflare D1** (legacy/secondary): ontology WH status — not used by invoice audit

## Key Constraints

- **13-sheet workbook contract**: Exact order enforced. `00_Decision` through `99_Manifest`.
- **Approval gates**: PASS/AMBER/ZERO/FAILED. ZERO blocks export. AMBER needs reviewer approval.
- **3-way reconciliation**: Final Subtotal = Line_Audit = TYPE-B (±0.01 tolerance)
- **Currency**: AED/USD only. FX policy check via `check_fx_policy`.
- **CSP header**: `Content-Security-Policy` set in `apps/web/next.config.js` — restricts script-src, connect-src (Vercel Blob + Neon), frame-ancestors 'none'.
- **Batch validation**: `check_rate_card_batch({checks: [{charge_code, lane, rate}, ...]})` collapses N line calls into 1 query (performance plan v1).

## File Map

| Path | What |
|---|---|
| `apps/web/src/lib/` | Core logic: job-store, gate-bridge, MCP tools, parser-client, blob, types |
| `apps/web/src/lib/types.ts` | Zod schemas — JobStatus, Verdict, InvoiceLine, SourceFile, etc. |
| `apps/web/src/app/api/` | 12 API route handlers |
| `apps/web/tests/` | 30 Vitest test files |
| `apps/worker-py/app/parsers/` | xlsx, md, txt, pdf, pdf_json, dsv_waybill parsers |
| `apps/worker-py/app/exporters/` | 13-sheet workbook export |
| `apps/mcp-server/src/tools/` | 14 validation tools (re-export from @invoice-audit/tools) |
| `packages/tools/src/` | **14 MCP tools (single source of truth)** — check_rate_card, check_rate_card_batch, etc. |
| `packages/database/src/index.ts` | Postgres pool singleton (shared by web + mcp-server) |
| `packages/contracts/` | Shared Zod schemas |
| `packages/shared/` | Hash, redaction helpers |
| `packages/telemetry/` | OpenTelemetry helpers (@invoice-audit/telemetry, used by web + mcp-server) |
| `migrations/` | Postgres DDL (0008-0011) |
| `.github/workflows/` | 8 CI/CD workflows |
| `shpiment/` | DSV shipment reference (gitignored) |
| `domestic/` | Korean domestic invoice runtime |

## Verification Baseline (2026-06-15)

- apps/web: 157 tests (30 files), `pnpm test`
- apps/worker-py: 149 tests, `pytest -q` (needs openpyxl, pdfplumber, pytest-cov)
- apps/mcp-server: 186 tests (16 files), `pnpm test`
- **Total: 492 tests passing**

## Rules

- Numbers: 2 decimal places, comma thousands. Dates: YYYY-MM-DD.
- Currency columns: mark USD or AED explicitly.
- Invoice amount delta > 2% → highlight + reason memo.
- File names: YYYYMMDD_description_v1.ext
- Output language: Korean (internal), business English (external).
