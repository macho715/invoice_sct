# SCT Invoice Audit Platform

3-app architecture for HVDC invoice processing + cost guard + approval gates.
Samsung C&T HVDC Abu Dhabi project. ADNOC/DSV partnership.

## Rule #0 — 최우선 원칙 (모든 규칙 위에 있음)

> **이 한 줄이 시스템의 존재 이유다. 아래의 모든 규칙·게이트·판정과 충돌하면 이 원칙이 이긴다.**

**사용자가 EXCEL 인보이스 OR PDF 증빙을 업로드하면, 무조건 최종 EXCEL 파일(13-sheet 감사팩)을 사용자에게 제공한다.**

- **OR 시맨틱 (AND 아님)**: Excel 청구서 **단독**, PDF 증빙 **단독**, 또는 **둘 다** — 어느 경우든 최종 Excel 보고서를 산출한다. 한쪽만 올렸다고 거부하지 않는다.
- **무조건 산출**: 검증 결과가 PASS/AMBER/ZERO 무엇이든 최종 Excel은 항상 나온다. 미검증·위반 항목은 워크북 안에서 **표기**(Action Items / Evidence Issues / verdict 컬럼)할 뿐, 산출물 제공 자체를 막지 않는다.
  - PDF 단독 → 구조화된 라인이 없으면 AMBER로 표기하되, 최종 Excel은 제공한다.
  - ZERO → "차단/미검증"으로 라벨링하되, Review Pack Excel은 항상 다운로드 가능하다.
- **검증 최대화**: 업로드된 자료에서 추출·매칭·검증 가능한 것은 전부 수행한 뒤 산출한다. 자료가 불완전해도 "검증 가능한 범위까지" 끝까지 한 다음 결과를 표기한다.
- **충돌 해소**: 아래 approval gate·3-tier 판정·기타 규칙이 "Excel 제공"을 막는 방향으로 작동하면, 이 원칙을 우선하여 **최대한 검증한 최종 Excel을 제공**한다.

### 예정 프로세스 — 업로드 인테이크 → 최종 Excel (OR)

```
업로드 (Excel 인보이스 OR PDF 증빙, 또는 둘 다)
  ↓ 인보이스 소스 결정 (OR, AND 아님)
     · xlsx/md/txt 있음 → 그것을 invoice 소스, PDF는 evidence
     · xlsx/md/txt 없음 → 첫 PDF를 invoice 소스, 나머지 PDF는 evidence
  ↓ 파싱 (xlsx/md/txt 구조화 / pdf = pdfplumber)
  ↓ 검증 최대화 (rate/evidence/cost/shipment/tax/FX/HS/DEM-DET) → 게이트 (PASS/AMBER/ZERO)
     · PDF 단독으로 라인 0 추출 → AMBER + REVIEW_REQUIRED (NO_INVOICE_LINES_EXTRACTED 표기)
  ↓ 최종 13-sheet Excel 감사팩 산출 (무조건)
     · PASS → Final Approved Workbook   · AMBER → 승인 후 Final / Review Pack 즉시
     · ZERO → Review Pack (차단/미검증 라벨링, 다운로드는 항상 가능)
```

**상태:**
- ✅ **구현됨 (2026-06-15)**: OR 인테이크(409 제거), PDF-as-invoice 소스, 0-라인 → AMBER 표기, 최종 Excel 경로. (`run/route.ts`, `upload-validation.ts`, `upload-form.tsx`)
- 🔜 **예정**: ① 워커 `pdf_text.py`의 text_span → `invoice_lines` 실추출 (Phase 2.5) — PDF 단독을 AMBER가 아닌 실검증으로 승격. ② `EXPORT_FAILED` prod 해결 — 워커 `/v1/export` 도달·환경변수 (Rule #0 다운로드 보장의 전제).

## DLP 정책 (2026-06-15 추가)

**DLP는 시스템에 추가하지 않음** — 새로운 DLP(Data Loss Prevention) 기능·모듈·도구를 시스템에 추가하지 않음. 기존 P2 DLP 규칙은 2026-06-15에 제거됨.

## Quick Commands

```bash
# Web app (Next.js 15)
cd apps/web && pnpm dev          # localhost:3000
pnpm --dir apps/web typecheck    # 0 errors baseline
pnpm --dir apps/web test         # 166 tests
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
  ├── Upload → Vercel Blob (Excel invoice OR PDF — OR intake, Rule #0)
  ├── API routes orchestrate full audit pipeline
  ├── run/route.ts — invoice-source selection (xlsx/md/txt, else first PDF),
  │                  parse → validate → gate; zero-lines → AMBER (never 409)
  ├── gate-bridge.ts — PASS/AMBER/ZERO/FAILED verdicts
  ├── workbook-builder.ts — 13-sheet contract assembly
  ├── Imports MCP tools from @invoice-audit/tools (14 tools, single source of truth)
  └── fetch → apps/worker-py for /v1/parse, /v1/export, /v1/notebooklm/run (flag-gated)

apps/worker-py (FastAPI, Fly.io)
  ├── /v1/parse — xlsx/md/txt/pdf/pdf_json + DSV waybill (alias /parse, deprecated)
  ├── /v1/export — 13-sheet audit workbook
  └── /v1/notebooklm/run — MarkItDown → NotebookLM orchestrator (callback to web)

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

- apps/web: 166 tests (30 files), `pnpm test` (verified 2026-06-15 after Rule #0 OR intake)
- apps/worker-py: 149 tests, `pytest -q` (needs openpyxl, pdfplumber, pytest-cov)
- apps/mcp-server: 186 tests (16 files), `pnpm test`
- **Total: 501 tests passing**

## Rules

- Numbers: 2 decimal places, comma thousands. Dates: YYYY-MM-DD.
- Currency columns: mark USD or AED explicitly.
- Invoice amount delta > 2% → highlight + reason memo.
- File names: YYYYMMDD_description_v1.ext
- Output language: Korean (internal), business English (external).
