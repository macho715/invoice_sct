# SCT Invoice Audit Platform

3-app architecture for HVDC invoice processing + cost guard + approval gates.
Samsung C&T HVDC Abu Dhabi project. ADNOC/DSV partnership.

## Quick Commands

```bash
# Web app (Next.js 15)
cd apps/web && pnpm dev          # localhost:3000
pnpm --dir apps/web typecheck    # 0 errors baseline
pnpm --dir apps/web test         # 107 tests
pnpm --dir apps/web build        # production build

# Python worker (FastAPI)
cd apps/worker-py && uvicorn app.main:app --port 8000
cd apps/worker-py && pytest -q   # 95 tests

# MCP server (Hono, standalone)
cd apps/mcp-server && pnpm dev   # localhost:8080
cd apps/mcp-server && pnpm test  # 186 tests
```

## Architecture

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

## Database

- **Neon Postgres** (primary): jobs, gate results, invoices, traces, rate cards — via `DATABASE_URL`
- **Vercel Blob** (private): invoice/evidence files, export artifacts — via `BLOB_READ_WRITE_TOKEN`
- **Cloudflare D1** (legacy/secondary): ontology WH status — not used by invoice audit

## Key Constraints

- **P2 DLP**: No invoices, rates, TRN, BOE, BL, container numbers, or PII committed. Strict `.gitignore` entries.
- **13-sheet workbook contract**: Exact order enforced. `00_Decision` through `99_Manifest`.
- **Approval gates**: PASS/AMBER/ZERO/FAILED. ZERO blocks export. AMBER needs reviewer approval.
- **3-way reconciliation**: Final Subtotal = Line_Audit = TYPE-B (±0.01 tolerance)
- **16 P2 categories** in DLP export gate
- **Currency**: AED/USD only. FX policy check via `check_fx_policy`.
- **CSP header**: `Content-Security-Policy` set in `apps/web/next.config.js` — restricts script-src, connect-src (Vercel Blob + Neon), frame-ancestors 'none'.
- **Batch validation**: `check_rate_card_batch({checks: [{charge_code, lane, rate}, ...]})` collapses N line calls into 1 query (performance plan v1).

## File Map

| Path | What |
|---|---|
| `apps/web/src/lib/` | Core logic: job-store, gate-bridge, MCP tools, DLP, parser-client, blob, types |
| `apps/web/src/lib/types.ts` | Zod schemas — JobStatus, Verdict, InvoiceLine, SourceFile, etc. |
| `apps/web/src/app/api/` | 11 API route handlers |
| `apps/web/tests/` | 23 Vitest test files |
| `apps/worker-py/app/parsers/` | xlsx, md, txt, pdf, pdf_json, dsv_waybill parsers |
| `apps/worker-py/app/exporters/` | 13-sheet workbook export |
| `apps/mcp-server/src/tools/` | 14 validation tools (re-export from @invoice-audit/tools) |
| `packages/tools/src/` | **14 MCP tools (single source of truth)** — check_rate_card, check_rate_card_batch, etc. |
| `packages/database/src/index.ts` | Postgres pool singleton (shared by web + mcp-server) |
| `packages/contracts/` | Shared Zod schemas |
| `packages/shared/` | Hash, redaction, DLP helpers |
| `migrations/` | Postgres DDL (0008-0010) |
| `.github/workflows/` | 8 CI/CD workflows |
| `shpiment/` | DSV shipment reference (P2, gitignored) |
| `domestic/` | Korean domestic invoice runtime |

## Verification Baseline (2026-06-14)

- apps/web: 107 tests, typecheck 0 errors
- apps/worker-py: 95 tests, py_compile OK
- apps/mcp-server: 186 tests, typecheck 0 errors
- **Total: 388 tests, 0 type errors**

## Rules

- Numbers: 2 decimal places, comma thousands. Dates: YYYY-MM-DD.
- Currency columns: mark USD or AED explicitly.
- Invoice amount delta > 2% → highlight + reason memo.
- DLP: never paste raw P2 content into prompts, logs, or docs.
- File names: YYYYMMDD_description_v1.ext
- Output language: Korean (internal), business English (external).
