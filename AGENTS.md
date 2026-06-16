# AGENTS.md

## Purpose
This repository is the SCT HVDC Invoice Audit Platform for invoice, shipment, evidence, cost, HS/UAE compliance, DEM/DET, approval gates, and 13-sheet workbook workflows.
Agents must optimize for correctness, auditability, privacy, and minimal diffs. Do not infer contract rates, customs evidence, shipment references, or deployment settings.

## Rule #0 — Upload Intake & Final Excel Guarantee (highest priority)
> This single rule outranks every gate and verdict below. On conflict, Rule #0 wins. Mirror of `CLAUDE.md` Rule #0.

When the user uploads an **Excel invoice OR a PDF (evidence)** — either one alone, or both — the system MUST always deliver a final Excel (13-sheet audit pack). OR semantics, never AND.

Planned intake process:
```
Upload (Excel invoice OR PDF, or both)
  -> Invoice-source selection (OR):
       xlsx/md/txt present  -> use it as invoice source, PDFs are evidence
       xlsx/md/txt absent    -> use first PDF as invoice source, remaining PDFs are evidence
  -> Parse (xlsx/md/txt structured | pdf via pdfplumber)
  -> Maximize validation -> gate (PASS/AMBER/ZERO)
       PDF-only with 0 extracted lines -> AMBER + REVIEW_REQUIRED (NO_INVOICE_LINES_EXTRACTED)
  -> Always produce the 13-sheet Excel: PASS=Final, AMBER=approve then Final / Review Pack now,
     ZERO=Review Pack (labeled blocked/unverified; download always allowed)
```
- Never 409 a PDF-only upload; never refuse the deliverable. Unverified/violating items are LABELED inside the workbook, not used to block export.
- Status: IMPLEMENTED 2026-06-15 (`apps/web/src/app/api/invoice-audit/run/route.ts`, `upload-validation.ts`, `upload-form.tsx`).
- VERIFIED 2026-06-16: gs:// Google Vision OCR fallback shipped; Rule #0 verified end-to-end in prod (ingest -> run -> export -> download -> valid 13-sheet xlsx for a ZERO verdict).
- Planned: (1) worker `pdf_text.py` text_span -> `invoice_lines` real extraction (promotes PDF-only beyond AMBER; OCR path now covered by gs:// Vision fallback, text_span->line mapping remains); (2) resolve prod `EXPORT_FAILED` on worker `/v1/export` (export -> download path confirmed by the 2026-06-16 end-to-end verification).
# [ASSUMPTION] PDF-only real line extraction and the prod export fix are not yet implemented. Verify worker /v1/export reachability and pdf_text line-mapping before claiming full Rule #0 coverage.

## Evidence Checked
- Repo evidence: `README.md`, `CLAUDE.md`, `package.json`, `pnpm-workspace.yaml`, `apps/web/package.json`, `apps/mcp-server/package.json`, `apps/worker-py/pyproject.toml`.
- CI evidence: `.github/workflows/web-ci.yml`, `python-worker-ci.yml`, `release-gate.yml`, `secret-scan.yml`.
- Target design: `20260615_MarkItDownMCP_GoogleVision_통합_WORKFLOW_PROCESS_상세설계서_v1.md`.

## Project Layout
- `apps/web`: Next.js 15 / React 19 app, upload UI, API routes, audit orchestration, approval, final gate, workbook handoff.
- `apps/worker-py`: FastAPI parser/export worker for xlsx/md/txt/pdf/pdf_json, DSV waybill extraction, NotebookLM helper orchestration.
- `apps/mcp-server`: Hono TypeScript JSON-RPC MCP server for external clients.
- `packages/tools`: 15 validation tools; treat as the audit tool SSOT.
- `packages/contracts`: shared Zod schemas and API contracts.
- `packages/database`: Neon/Postgres pool singleton.
- `packages/shared`: hash and redaction helpers.
- `migrations`: Postgres DDL.
- `.github/workflows`: CI/CD and release gates.

## Architecture Boundaries
- Web app owns final audit orchestration, `Gate Bridge`, approval, and user-facing result/export flow.
- Parser worker may parse, normalize, OCR-orchestrate, and format exports, but must not become the final business verdict authority.
- **DOMESTIC workflow** (2026-06-16): upload-form `workflow_type` (`SHIPMENT`|`DOMESTIC`) gates the entire pipeline — domestic skips HS/UAE, shipment_match, fx_policy, dem_det; uses `domestic_lane_check` (15th tool) for lane/distance/short-run validation; `check_rate_card` queries `rate_cards` by composite lane key; gate-bridge produces Korean action items. Domestic invoices carry `origin`/`destination`/`vehicle`/`distance_km` fields from xlsx headers or DSV waybill extraction.
- MCP tools own rate/evidence/cost/HS/duplicate/contract/shipment/tax/FX/DEM-DET validation functions.
- NotebookLM/NoteLM is extraction evidence only. It must never produce the final audit verdict.
- MarkItDown MCP is a markdown/evidence conversion layer only. It must never decide PASS/AMBER/ZERO.
- Google Vision is OCR only. Do not expect Vision to structure invoice semantics by itself.

## Current vs Target Runtime
- Current repo evidence shows: Vercel web, Vercel Blob, Neon Postgres, FastAPI worker, Hono MCP server.
- Target design moves source/evidence/OCR/markdown/export artifacts to GCS and parser/MarkItDown/MCP services to Cloud Run.
# [ASSUMPTION] Google Cloud migration is target-state design, not fully proven as deployed code. Verify with: deployment manifests, Cloud Run services, GCS buckets, and env config before production changes.
- Short term target: Vercel UI + Google Cloud backend. Medium term target: full Cloud Run web + parser + MarkItDown MCP + Vision API + Cloud SQL + GCS export.

## Commands
Use repository root for workspace commands unless noted.
- Root install: `pnpm install`
- CI install: `pnpm install --frozen-lockfile`
- Web dev: `cd apps/web && pnpm dev`
- Web typecheck: `pnpm --dir apps/web typecheck`
- Web test: `pnpm --dir apps/web test -- --run`
- Web build: `pnpm --dir apps/web build`
- Web E2E: `pnpm --dir apps/web e2e`
- Web a11y placeholder: `pnpm --dir apps/web a11y`
# [ASSUMPTION] `a11y` currently appears to be a placeholder script. Verify before treating it as a real accessibility gate.
- Worker install: `cd apps/worker-py && uv sync --frozen`
- Worker local editable install: `cd apps/worker-py && python -m pip install -e ".[dev]"`
- Worker dev server: `cd apps/worker-py && python -m uvicorn app.main:app --port 8000`
- Worker tests: `cd apps/worker-py && python -m pytest tests/ -q`
- Worker CI tests: `cd apps/worker-py && uv run pytest`
- NotebookLM route check: `cd apps/worker-py && python -m pytest tests/test_notebooklm_route.py -q`
- MCP dev: `cd apps/mcp-server && pnpm dev`
- MCP typecheck: `pnpm --dir apps/mcp-server typecheck`
- MCP test: `pnpm --dir apps/mcp-server test -- --run`
- MCP build: `pnpm --dir apps/mcp-server build`

## Verification Rules
- Run the smallest relevant checks first.
- For web/API changes, run web typecheck and targeted Vitest before build.
- For worker changes, run targeted pytest first, then worker test suite if parser/export behavior changed.
- For MCP tool changes, run typecheck and tests for `apps/mcp-server`; preserve 14-tool cardinality.
- For workbook changes, validate the 13-sheet order and sidecar manifest behavior.
- If GitHub Actions cannot run because of billing, record local commands and pass/fail output in the handoff.
- Do not report success until commands run or the unverified area is explicitly stated.

## Release / Deployment
- Production deploy, Cloud Run changes, Fly.io changes, Vercel env changes, database migrations, and storage bucket changes are MANUAL.
- Ask for explicit approval before `vercel --prod`, changing GitHub Actions deployment workflows, modifying IAM, rotating secrets, or editing production env vars.
- Preserve release-gate groups: Python CI, TS checks, Playwright smoke, and gate summary.
# [ASSUMPTION] Production deployment target is changing from Vercel/Fly/Neon toward Google Cloud. Verify the approved cutover plan before replacing existing deployment workflows.

## Security / Privacy
- LP/DLP is not a system component for this repository. Do not add LP or DLP as a new gate, service, module, verdict source, upload blocker, export blocker, or workflow phase.
- Existing P2/DLP policy language is removed from the active repository rules. Do not reintroduce P2/DLP-based blocking unless the user explicitly asks for a new policy change.
- Treat uploaded invoices, PDFs, Excel files, Markdown artifacts, OCR JSON, and workbook exports as private audit data.
- Never commit raw invoices, raw contract rates, TRN, BOE, BL, container numbers, emails, phone numbers, tokens, private URLs, or original evidence.
- Never paste secret values into issues, docs, prompts, logs, screenshots, or test fixtures.
- Secret names are allowed only when necessary: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `API_SECRET_KEY`, `CALLBACK_HMAC_SECRET`, `NOTEBOOKLM_CALLBACK_SECRET`, `MCP_SHARED_SECRET`.
- Keep approval gates for AMBER and ZERO findings.
- Preserve redaction, secret scanning, and private storage controls as safety controls, but do not label them as LP/DLP gates.
- Use `.gitleaks.toml` and `secret-scan.yml` as the current secret-scan baseline.

## Google Vision / GCS Rules
- Use Vision only for scanned/image PDFs or low-confidence text extraction unless the user explicitly chooses a stronger policy.
- Default policy: `VISION_POLICY=AUTO`.
- Store OCR JSON under the OCR artifact path and keep raw OCR text out of logs.
- GCS buckets must remain private. Use signed URLs only for controlled upload/download.
- Separate `source_sha256`, `vision_json_sha256`, `markdown_sha256`, `normalized_sha256`, and `workbook_sha256`.
- Reject or ZERO any source hash mismatch.

## MarkItDown MCP Rules
- Default policy: `MARKITDOWN_POLICY=ALWAYS_FOR_PDF`.
- Accept only GCS internal/signed object inputs. Do not allow arbitrary local paths or arbitrary external URLs.
- Block private IP, loopback, link-local, and metadata-server access.
- Enforce max file size, max pages, timeout, and result-size limits.
- Use `convert_gcs_to_markdown`, `vision_json_to_markdown`, and `extract_markdown_refs` as artifact/evidence tools.
- A MarkItDown timeout may continue with parser/Vision, but high-impact mismatch must become AMBER.

## NotebookLM / NoteLM Rules
- Default policy: `NOTEBOOKLM_POLICY=OFF`.
- Use only for redacted/synthetic samples or explicit manual approval.
- Do not auto-send private audit documents to NotebookLM without explicit manual approval.
- NotebookLM success without parser confidence is AMBER manual review, not PASS.
- NotebookLM used without approval is ZERO.

## Audit Logic Rules
- Verdict rank: `PASS < AMBER < ZERO < FAILED`.
- Final reconciliation must compare invoice total, line audit total, and TYPE-B total with `0.01` tolerance where applicable.
- BOE missing on customs, duplicate invoice, source hash mismatch, or unauthorized NotebookLM use are ZERO-class risks.
- Parser/OCR confidence below threshold and OCR/Markdown high-impact mismatch are AMBER unless policy says ZERO.
- Use AED/USD explicitly. Format numbers to 2 decimals.

## 13-Sheet Workbook Contract
Do not rename, remove, reorder, or hide these sheets:
1. `00_Decision`
2. `01_Action_Items`
3. `02_Final_Recon`
4. `03_Header_Check`
5. `04_Line_View`
6. `05_Duplicate_Check`
7. `06_Rate_Check`
8. `07_Tax_FX_Check`
9. `08_Shipment_Match`
10. `90_Source_Data`
11. `91_Audit_Detail`
12. `92_Evidence_Issues`
13. `99_Manifest`
Vision/MarkItDown raw artifacts should be stored as GCS sidecars and referenced from manifest/audit sheets, not dumped wholesale into workbook sheets.

## Coding Rules
- Prefer minimal, reviewable diffs. Follow existing repository patterns before adding abstractions.
- Do not add dependencies without approval.
- Do not edit generated files, lockfiles, migrations, auth, CI, or deployment configuration unless the task explicitly requires it.
- Keep TypeScript ESM style in TypeScript packages.
- Keep Python worker changes typed and testable; do not suppress parser errors to force PASS.
- Preserve public API contracts and Zod schema compatibility.

## Agent Output Contract
When finishing work, report files changed, commands run with pass/fail, whether 13-sheet workbook / 14-tool MCP / PASS-AMBER-ZERO behavior were affected, security risks checked, and remaining unverified areas.
