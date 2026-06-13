# Changelog

## Documented Current State - 2026-05-25

### Added

- Added synchronized project-doc-pipeline documents under `docs/` for architecture, layout, changelog, and guide coverage.
- Documented `get_hvdc_case_status` case-card behavior and warehouse status D1 projection commands.
- Documented Widget v10 operational behavior and focused widget troubleshooting.

### Changed

- Current documentation baseline now reflects Cloudflare Worker runtime, `ui://hvdc/answer-card-v10.html`, Case Status Card rendering, and WH status D1/SSOT workflow.
- The root historical docs remain in place for continuity, while `docs/SYSTEM_ARCHITECTURE.md`, `docs/LAYOUT.md`, and `docs/GUIDE.md` provide concise current-state docs.

### Fixed

- Documented the latest widget containment fix for Case Status Card tables and `canonicalEvents` horizontal scrolling inside the card.

### Verified

- `npm run worker:deploy` executed `npm run verify` before deployment.
- Verification baseline: 22 test files and 302 tests passed.
- Cloudflare Worker deployed at `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`.
- `/healthz` returned HTTP 200.
- `/mcp get_hvdc_case_status caseNo=207721` returned `WHCASE-207721`, `WARN`, `M100_FINAL_DELIVERED`, `canonicalEvents=6`, `caseCard=36`, and output template `ui://hvdc/answer-card-v10.html`.


## SESS-005 — Cross-validation & Track 1↔Track 2 Gap Patching (2026-06-13)

### Added
- DSV Waybill parser port: `apps/worker-py/app/parsers/dsv_waybill.py` (8 core functions from Track 1, 28 tests)
- `classify_type_b` MCP tool (8-class priority classification, Track 1 `TYPE_B_Rules` port)
- `check_hs_uae_compliance` MCP tool (BOE validation, HS code format check)
- `check_dem_det` MCP tool (DEM/DET evidence requirement check, final settlement ZERO trigger)
- `checkReconciliation()` 3-way tie-out in gate-bridge (Final Subtotal = Line_Audit = TYPE-B ±0.01)
- `checkDlpExport()` DLP scan in export pipeline (violations → ZERO block)
- `scanWorkbook()` DLP scanner method (16 P2 categories)
- InvoiceHeader field extraction in xlsx parser (invoice_no, vendor, issue_date from Excel)
- xlsx parser column expansion (shipment_ref, job_number, rate_basis, for_charge_component)
- `rate_cards` DB seed script (20 HVDC rate records, 6 charge types)
- `present_evidence` input for evidence_required tool (end-to-end evidence tracking)
- `applied_rate` input for rate_card tool (variance calculation now functional)
- evidence finding merge into final gate verdict (doc_guardian → ZERO/AMBER escalation)
- event tracking trace to SESS-005

### Changed
- MCP tools: 11 → 14 (all 14 with tests and typecheck)
- numeric_integrity verdict: AMBER → ZERO (aligned with Track 1 hard_blocker #11)
- gate-bridge now accepts `evidenceFindings` and `checkReconciliation`
- cf-mcp-client orchestrates `classify_type_b` and `check_hs_uae_compliance` per line
- DLP scanner: 12 → 16 P2 categories (added VESSEL_VOYAGE, APPROVAL_TEXT, INTERNAL_AMOUNT, DUPLICATE_INVOICE)
- BLOB_HEALTHCHECK_URL default → empty string (graceful skip when unset)
- web job detail page restored API fetch (in-memory STORE failed on Vercel serverless)
- vercel deploy workflow: `working-directory: apps/web` + pnpm

### Fixed
- P0: `check_rate_card.ts:68` dead code (`appliedRate=null` → uses input)
- P0: `check_evidence_required.ts:35` dead code (`present=[]` → uses input)
- P0: upload-form large file routing (>4.5MB → `/api/files/ingest/large`)
- P1: numeric_integrity verdict inconsistency (AMBER → ZERO)
- P1: 3-way reconciliation tie-out added to buildGateResult flow
- P1: rate_cards DB seed created

### Removed
- 11 dependabot PRs closed (version bumps deferred)
- `BLOB_HEALTHCHECK_URL` dummy fallback `http://127.0.0.1:65535/health-probe-dummy`

### Verified
- Worker-PY: 95 tests PASS
- MCP Server: 186 tests PASS (15 test files)
- Web: 107 tests, 24 test files (2 cf-mcp-client tests require live CF worker)
- Typecheck: 0 errors across all components
- Cross-validation: Track 1 9 gates → 8 FULL, 1 P3 (Harness/RTM, CI-dependent)
- Commit: `3cb5c13`, 20 commits in SESS-005

## Codex Documentation Update — 2026-06-13T18:20:29.442785+00:00

**Update policy:** existing content above this section is preserved. This section was appended after scanning code, documentation, config, and agent profile files.

**Purpose:** This section records the documentation refresh event without altering earlier changelog entries.

### Evidence inventory

**Source/code files sampled:**
- `apps\mcp-server\src\__tests__\router.test.ts`
- `apps\mcp-server\src\__tests__\schema-contract.test.ts`
- `apps\mcp-server\src\db.ts`
- `apps\mcp-server\src\main.ts`
- `apps\mcp-server\src\schemas\dlp-guard.ts`
- `apps\mcp-server\src\tools\__tests__\build_validation_explanation.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_contract_validity.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_cost_guard.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_duplicate_invoice.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_evidence_required.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_fx_policy.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_rate_card.test.ts`

**Documentation files sampled:**
- `.vercel\README.txt`
- `20260613_job_store_mcp_fix_plan.md`
- `apps\README.md`
- `apps\graphify-out\GRAPH_REPORT.md`
- `apps\graphify-out\converted\sample-invoice_c70e590b.md`
- `apps\web\.vercel\README.txt`
- `apps\worker-py\README.md`
- `apps\worker-py\invoice_audit_parser.egg-info\SOURCES.txt`
- `apps\worker-py\invoice_audit_parser.egg-info\dependency_links.txt`
- `apps\worker-py\invoice_audit_parser.egg-info\requires.txt`
- `apps\worker-py\invoice_audit_parser.egg-info\top_level.txt`
- `docs\# 3-Way 교차검증 보고서 (graph × 개발 현황 보고서 × Invoice Audit Platform v1.00).md`

**Config/build files sampled:**
- `.codex\root-docs-scan.json`
- `.github\dependabot.yml`
- `.github\workflows\codeql.yml`
- `.github\workflows\fly-worker-deploy.yml`
- `.github\workflows\python-worker-ci.yml`
- `.github\workflows\release-gate.yml`
- `.github\workflows\vercel-preview.yml`
- `.github\workflows\vercel-prod.yml`
- `.github\workflows\web-ci.yml`
- `.vercel\project.json`
- `apps\graphify-out\graph.json`
- `apps\mcp-server\package-lock.json`

**Agent profile files sampled:**
- No agent profile detected; this update records the absence explicitly.

### Mermaid graph

```mermaid
timeline
  title Documentation Update Timeline
  Scan : Code/docs/agent inventory captured
  Update : Append-only sections generated
  Verify : Mermaid and code-reflection checks completed
```

### Verification notes

- Append-only update generated by `root-docs-batch-update`.
- Code/config/doc/agent inventory counts: code=171, docs=99, config=264, agent_profiles=0.
- Follow-up verification should confirm that newly added text matches actual implementation paths listed above.
