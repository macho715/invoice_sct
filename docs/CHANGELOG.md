# Changelog

## NotebookLM MCP `waitForStableAnswer` BUGFIX + Test Infrastructure - 2026-06-14

> **Scope:** Patch the `notebooklm-mcp-pr53-pr55` fork to fix a 2m 10s timeout when a notebook accumulates prior answers with matching text. Adds opt-in diagnostic instrumentation, vitest unit tests, and project docs. All commits pushed to `macho715/notebooklm-mcp`. Upstream PR #61 opened against `PleasePrompto/notebooklm-mcp:main`.

### Fixed

- **Root cause:** `waitForStableAnswer` in `notebooklm-mcp-pr53-pr55/src/notebooklm/chat.ts` filtered candidates via `ignoreSet.has(candidate)` (line 269). When a new answer's text happened to match a prior response (e.g., repeated test prompts `{"ok": true"}`), the new answer was misclassified as "prior" and the streaming-stability loop timed out after 2m 10s.
- **Fix:** Dropped the `ignoreSet` text-match filter entirely. The DOM position (`.last()`) is the unique identity for "the new answer" by construction. The `isEcho` check (question text echoed back) and the `isPlaceholder` check (loading indicators like "Retrieving details...") are preserved.
- **Live verification:** 6 prior `{"ok": true}` + 1 new `{"ok": true"}` in notebook `2b70c1f5-6e08-47bb-801b-a3618004c3b5` — return time went from 2m 10s timeout to ~1s. Diagnostic evidence preserved in `artifacts/notebooklm-debug/2026-06-14T18-43-21-*` (gitignored).

### Added

- **Opt-in diagnostic harness:** `src/utils/diagnostics.ts` (NEW, 218 lines). 3-phase capture per `ask_question` call: initial snapshot (T+0), 1Hz trace for 15s, final snapshot (T+15s). Produces 11 files per call: 3 screenshots + 6 text/html files + `candidates.json` + `poll-trace.jsonl`. Gated by `NOTEBOOKLM_DIAGNOSTIC=true` (default off, zero overhead).
- **3 candidate selectors** evaluated: `.to-user-container .message-text-content` (primary, 5 matches in repro) + 2 fallbacks (`.conversation-turn`, `[data-response-id]/[data-author="assistant"]`). Primary selector confirmed working.
- **vitest test infrastructure:** `vitest.config.ts` + `tests/notebooklm/chat.test.ts` (4 unit tests, 1.94s). Regression test for the actual bug: 6 prior + 1 new (same text) returns new text. Also: 3 normal-path tests (different text, echo filter, timeout on unstable text).
- **Documentation:** README updated with `NOTEBOOKLM_DIAGNOSTIC` env var + "Debugging with NOTEBOOKLM_DIAGNOSTIC" section explaining the 11 artifact files.

### Changed

- `src/notebooklm/chat.ts`: removed `ignoreSet` setup, removed `isPrior` check, updated JSDoc on `AskOptions.ignoreTexts` (marked `@deprecated`, kept for API compat), added docstring paragraph explaining position-based identity.
- `src/session/browser-session.ts`: removed now-dead `existingResponses` snapshot block (lines 388-393), removed `snapshotPriorAnswers`/`snapshotAllResponses` imports, removed `ignoreTexts: existingResponses` argument from `waitForStableAnswer` call. Net: -8 lines of dead data plumbing.
- `src/types.ts`: removed orphaned `WaitForAnswerOptions` interface (zero consumers).
- `src/utils/page-utils.ts`: fixed stale comment that claimed `snapshotAllResponses` feeds the stability detector; the detector now uses DOM position only.
- `package.json`: `test` script changed from `tsx src/index.ts` (which started the MCP server) to `vitest run`. Vitest 4.1.8 added as devDependency.

### Commits

| SHA | Repo | Subject |
|---|---|---|
| `ab693c5` | MCP | feat(mcp): add opt-in diagnostic instrumentation to ask_question |
| `2f6ccdcb` | MCP | **fix(mcp): drop text-based ignoreSet in waitForStableAnswer** |
| `fc8cfca` | MCP | chore(mcp): cleanup dead snapshot plumbing |
| `1ed0a5b` | MCP | chore(mcp): gitignore diagnostic artifacts |
| `b942557` | MCP | test(mcp): add vitest + waitForStableAnswer unit tests |
| `3f4a0bb` | MCP | docs(mcp): document NOTEBOOKLM_DIAGNOSTIC env var |
| `d42c7c8` | MCP | chore(mcp): update package-lock.json for vitest |

### Verified

- `npx tsc --noEmit` — 0 errors.
- `npm test` — 4/4 vitest pass in 1.94s.
- Live smoke (HTTP mode, 120s timeout) — `{"ok": true"}` returned in ~1s vs prior 2m 10s timeout.
- Diagnostic evidence preserved at `artifacts/notebooklm-debug/2026-06-14T19-18-12-*` (gitignored).

### See also

- PR #61 (https://github.com/PleasePrompto/notebooklm-mcp/pull/61) — upstream MCP fix.
- PR #52 (https://github.com/PleasePrompto/notebooklm-mcp/pull/52) — independent fix by carlosorch for the same bug; comment posted on #52 with our alternative approach.
- `docs/superpowers/specs/2026-06-14-wait-for-stable-answer-ignore-set-bug-design.md` — BUGFIX design.
- `docs/superpowers/plans/2026-06-14-wait-for-stable-answer-ignore-set-bug.md` — implementation plan.
- `docs/superpowers/specs/2026-06-14-notebooklm-ask-question-diagnostic-patch-design.md` — diagnostic harness design.
- `docs/session-wraps/2026-06-14-notebooklm-ask-question-timeout.md` — intermediate wrap (BUGFIX work).
- `docs/session-wraps/2026-06-14-final-multi-skill-session.md` — final wrap (entire session).

## 3-Layer Role Definition + Architecture Audit - 2026-06-14

> **Scope:** Establish the canonical NoteLM/Worker/Vercel split, audit the implementation against it, and document the gap.

### Added

- **Canonical spec** at `docs/superpowers/specs/2026-06-14-final-role-definition-and-flow.md`:
  - **NoteLM** = verification field extraction agent (notebooklm-mcp fork + apps/mcp-server). Must NOT make the final audit verdict.
  - **Worker** = MarkItDown → NotebookLM → JSON normalize → Vercel callback orchestrator. Must NOT perform final amount or contract validation.
  - **Vercel** = receive gate, existing parser adapter, final audit engine, Excel/JSON result generation. Must NOT directly automate Chrome or NotebookLM.
- **Full data flow diagram** in the spec: User PDF upload → Vercel creates audit_job → Worker pulls → MarkItDown MCP → Worker → NoteLM/NotebookLM → Worker normalizes → Vercel callback → parser adapter → final audit engine → output.

### Changed

- `CLAUDE.md`: added "Architecture Status" section with role-vs-implementation mapping, known duplication (verdict logic, 13-sheet workbook), and migration status. Refined in `a6eae50` to clarify that worker's `exporters/xlsx.py` is a microservice formatter (verdict passed in, not computed) — not a spec violation.

### Commits

| SHA | Repo | Subject |
|---|---|---|
| `9027aa2` | SCT | docs(spec): finalize 3-layer role definition |
| `380700e` | SCT | feat(worker): default NotebookLM MCP timeout 30s → 300s |
| `a6eae50` | SCT | docs(arch): refine Worker audit |

### See also

- `docs/architecture_audit_2026-06-14.md` (inline) — worker's `exporters/xlsx.py` and `/v1/export` route are a microservice formatter, not a spec violation. Duplication is verdict logic only (`validators/numeric_integrity.py` + `gate-bridge.ts`).

## Worker NotebookLM MCP Default Timeout Hardening - 2026-06-14

### Changed

- Bumped `apps/worker-py/app/notebooklm/mcp_client.py` `NotebookLmMcpClient` default timeout from **30s → 300s** when neither `NOTEBOOKLM_MCP_TIMEOUT_MS` nor `NOTEBOOKLM_ASK_TIMEOUT_MS` is set.
- Rationale: full MCP `ask_question` cycle observed at ~30s in live smoke (browser init ~5s + type+submit ~4s + DIAG capture ~16s + answer generation ~10s + headroom). 300s gives 10x headroom and prevents the 60s+ timeouts observed in the BUGFIX debug session (`waitForStableAnswer` ignoreSet fix in `notebooklm-mcp-pr53-pr55`).
- The `AskOptions.ignoreTexts` parameter on the MCP side is kept for API compatibility but no longer consulted (see MCP fix `2f6ccdcb`).

### Verified

- Worker `pytest tests/test_notebooklm_mcp_client.py` — 18/18 passed with clean env.
- `apps/worker-py` overall pytest — 95 passed.
- Full project tsc — 0 errors.
- 4/4 MCP vitest unit tests for the new `waitForStableAnswer` behavior (commit `b942557`).

### See also

- `docs/superpowers/specs/2026-06-14-final-role-definition-and-flow.md` — canonical 3-layer role definition.
- `docs/superpowers/specs/2026-06-14-wait-for-stable-answer-ignore-set-bug-design.md` — ignoreSet BUGFIX design.
- `docs/session-wraps/2026-06-14-notebooklm-ask-question-timeout.md` — session wrap-up.
- PR #61 (https://github.com/PleasePrompto/notebooklm-mcp/pull/61) — upstream MCP fix.

## NotebookLM MCP Runtime Triage and Live Smoke Hardening - 2026-06-14

### Added

- Registered the user-provided NotebookLM URL in the local NotebookLM MCP library:
  - URL: `https://notebooklm.google.com/notebook/2b70c1f5-6e08-47bb-801b-a3618004c3b5`
  - Local notebook id: `invoice-audit-smoke-notebook`
- Set Windows User env `NOTEBOOKLM_DEFAULT_NOTEBOOK_ID=invoice-audit-smoke-notebook`.
- Started NotebookLM MCP over Streamable HTTP at `http://127.0.0.1:3003/mcp`.
- Started MarkItDown MCP over Streamable HTTP at `http://127.0.0.1:3001/mcp`.
- Added live smoke coverage for the real worker path:
  - local temporary PDF served over HTTP
  - MarkItDown MCP conversion
  - NotebookLM MCP source insertion attempt
  - worker callback path status reporting
- Added false-positive protection for NotebookLM MCP tool failures.
- Added callback rejection handling so `4xx` or `5xx` callback responses are no longer reported as successful `CALLBACK_SENT`.
- Added nested NotebookLM MCP error extraction so failures under `data.result.message` are surfaced instead of collapsed to a generic error.

### Changed

- Updated the worker MCP client to use the current Python MCP SDK Streamable HTTP contract.
- Replaced unsupported `streamable_http_client(..., timeout=...)` usage with an injected `httpx.AsyncClient`.
- Enabled `follow_redirects=True` for MCP HTTP calls so MarkItDown `/mcp` -> `/mcp/` redirects work.
- Updated NotebookLM `add_source` calls to use the real upstream schema:
  - before: `{"type": "text", "text": "..."}`
  - after: `{"type": "text", "content": "..."}`
- Propagated `NOTEBOOKLM_DEFAULT_NOTEBOOK_ID` into both `add_source` and `ask_question`.
- Hardened `NotebookLmOrchestrator.run()` result states:
  - `NOTEBOOKLM_TOOL_FAILED` for upstream MCP `success:false`
  - `CALLBACK_REJECTED` for callback HTTP status `>=400`
- Updated tests to cover:
  - MCP SDK timeout argument mismatch
  - `add_source.content` argument mapping
  - nested upstream tool failure messages
  - callback rejection not being treated as success

### Fixed

- Fixed the first runtime blocker: MCP Python SDK rejected the old `timeout` keyword.
- Fixed the second runtime blocker: NotebookLM MCP rejected the old `text` field for `add_source`.
- Fixed MarkItDown runtime wrapper failure caused by `307 Temporary Redirect` on `/mcp`.
- Fixed a false-success bug where NotebookLM `{"success":false,...}` output was treated as a source id.
- Fixed a false-success bug where callback `404` still returned `CALLBACK_SENT`.
- Fixed worker error reporting so the actual upstream selector timeout can be seen in worker output.

### Verified

- NotebookLM MCP `setup_auth` was executed with a visible browser and returned:
  - `success: true`
  - `status: authenticated`
  - `authenticated: true`
- NotebookLM MCP `list_notebooks` returned the registered notebook `invoice-audit-smoke-notebook`.
- MarkItDown MCP worker wrapper call succeeded:
  - `worker_markitdown=OK`
- NotebookLM MCP worker wrapper call succeeded for `list_notebooks`:
  - `worker_notebooklm=OK`
- Focused worker tests passed:
  - `python -m pytest tests/test_notebooklm_mcp_client.py tests/test_notebooklm_orchestrator.py tests/test_notebooklm_route.py -q` -> 21 passed
- Full worker test suite passed:
  - `python -m pytest tests/ -q` -> 129 passed
- `git diff --check` reported no patch errors for touched NotebookLM worker files.

### Current Live Smoke Result

- Live smoke now fails honestly instead of reporting false success.
- Current result:
  - `status: NOTEBOOKLM_UNAVAILABLE`
  - `error_code: NOTEBOOKLM_TOOL_FAILED`
  - detail includes upstream UI automation timeout from NotebookLM MCP.
- Direct upstream `add_source` call after authentication returned:
  - `success: false`
  - `sourceCountBefore: 0`
  - `sourceCountAfter: 0`
  - `locator.waitFor: Timeout 10000ms exceeded`
  - waiting for `locator('[role="dialog"]').first()` to become visible
  - hidden dialog matched first: `aria-label="이모티콘 문자 팔레트"`

### Upstream Findings

- Confirmed the current failure is already represented upstream.
- Relevant upstream issue:
  - `PleasePrompto/notebooklm-mcp#46`
  - covers empty-notebook `add_source` bootstrap failure and post-bootstrap source insertion failure.
- Relevant upstream PR:
  - `PleasePrompto/notebooklm-mcp#53`
  - directly matches this session's failure.
  - identifies hidden Emoji dialog false-positive from broad `[role="dialog"]` selector.
  - proposes scoping to visible dialogs and excluding Emoji palette dialogs.
- Additional relevant upstream PR:
  - `PleasePrompto/notebooklm-mcp#55`
  - updates current Add sources picker handling.
- No merged upstream fix was confirmed in `npx notebooklm-mcp@latest` during this session.

### Remaining Risks

- `npx notebooklm-mcp@latest` can still fail until upstream PR #53 or #55 is merged and released.
- Local live smoke cannot complete end-to-end while upstream `add_source` cannot add a source to the notebook.
- Real Vercel callback success still requires:
  - a real audit job id
  - matching `NOTEBOOKLM_CALLBACK_SECRET` on the worker and Vercel deployment
  - successful NotebookLM source insertion and JSON extraction
- This changelog intentionally does not include raw PDF body, raw Markdown body, or callback secret values.

### Next Candidate Action

- Apply PR #53 or PR #55 locally to the NotebookLM MCP package or run from the contributor branch, then rerun live smoke.

## NotebookLM Worker Gate and Documentation Refresh - 2026-06-14

### Added

- Added the NotebookLM worker gate implementation in commit `83d96d2`.
- Added worker-side first-pass extraction orchestration through `POST /v1/notebooklm/run`.
- Added web-side HMAC callback intake through `POST /api/notebooklm/ingest-summary`.
- Added `apps/worker-py/scripts/notebooklm_live_smoke.py` for env-backed live MCP/callback smoke verification.

### Changed

- Refreshed root documentation for the NotebookLM worker gate in commit `c674724`.
- Removed DLP references from the AGENTS patch in commit `fb16a92`.
- Updated README and GUIDE to describe the parser-authoritative NotebookLM helper path, required environment variables, and focused verification commands.

### Verified

- Pushed commits to `origin/main`: `83d96d2`, `c674724`, `fb16a92`.
- Worker tests: `python -m pytest tests/ -q` -> 123 passed.
- NotebookLM worker focused tests: `python -m pytest -q -o addopts='' tests/test_notebooklm_extractor.py tests/test_notebooklm_mcp_client.py tests/test_notebooklm_orchestrator.py` -> 25 passed.
- NotebookLM worker route tests: `python -m pytest -q -o addopts='' tests/test_notebooklm_route.py` -> 3 passed.
- Live smoke helper without env: `python scripts/notebooklm_live_smoke.py --job-id test_job --blob-url http://test/blob.pdf` -> `ENV_MISSING`.
- NotebookLM web callback tests: `npx vitest run tests/api-notebooklm-ingest-summary.test.ts` -> 12 passed.
- Web typecheck: `pnpm --filter @invoice-audit/web typecheck` -> pass.
- Root docs verification: `root_docs_batch_update.py verify` -> passed, score 100.0.

### Unverified

- Real MarkItDown MCP, NotebookLM MCP, and persistent Chrome host deployment were not verified in this session.
- Current NotebookLM confidence is based on mocked worker tests and web callback tests, not a live NotebookLM browser session.

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


## Codex Documentation Update — 2026-06-13T21:10:45.952547+00:00

**Update policy:** existing content above this section is preserved. This section was appended after scanning code, documentation, config, and agent profile files.

**Purpose:** This section records the documentation refresh event without altering earlier changelog entries.

### Evidence inventory

**Source/code files sampled:**
- `apps\mcp-server\db\migrate-rate-cards.sql`
- `apps\mcp-server\db\seed-rate-cards.sql`
- `apps\mcp-server\src\__tests__\router.test.ts`
- `apps\mcp-server\src\__tests__\schema-contract.test.ts`
- `apps\mcp-server\src\db.ts`
- `apps\mcp-server\src\main.ts`
- `apps\mcp-server\src\schemas\dlp-guard.ts`
- `apps\mcp-server\src\tools\__tests__\build_validation_explanation.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_contract_validity.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_cost_guard.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_dem_det.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_duplicate_invoice.test.ts`

**Documentation files sampled:**
- `.vercel\README.txt`
- `20260613_cross_validation_report.md`
- `20260613_dsv_waybill_port_plan.md`
- `20260613_job_store_mcp_fix_plan.md`
- `20260613_p2_gap_design.md`
- `README.md`
- `apps\README.md`
- `apps\graphify-out\GRAPH_REPORT.md`
- `apps\graphify-out\converted\sample-invoice_c70e590b.md`
- `apps\web\.vercel\README.txt`
- `apps\worker-py\README.md`
- `apps\worker-py\invoice_audit_parser.egg-info\SOURCES.txt`

**Config/build files sampled:**
- `.claude\settings.local.json`
- `.codex\root-docs-scan.json`
- `.codex\root-docs-write.json`
- `.github\dependabot.yml`
- `.github\workflows\codeql.yml`
- `.github\workflows\fly-worker-deploy.yml`
- `.github\workflows\python-worker-ci.yml`
- `.github\workflows\release-gate.yml`
- `.github\workflows\vercel-preview.yml`
- `.github\workflows\vercel-prod.yml`
- `.github\workflows\web-ci.yml`
- `.vercel\project.json`

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
- Code/config/doc/agent inventory counts: code=182, docs=108, config=451, agent_profiles=0.
- Follow-up verification should confirm that newly added text matches actual implementation paths listed above.


## Codex Documentation Update — 2026-06-14T09:41:25.480989+00:00

**Update policy:** existing content above this section is preserved. This section was appended after scanning code, documentation, config, and agent profile files.

**Purpose:** This section records the documentation refresh event without altering earlier changelog entries.

### Evidence inventory

**Source/code files sampled:**
- `apps\mcp-server\db\migrate-rate-cards.sql`
- `apps\mcp-server\db\seed-rate-cards.sql`
- `apps\mcp-server\src\__tests__\router.test.ts`
- `apps\mcp-server\src\__tests__\schema-contract.test.ts`
- `apps\mcp-server\src\db.ts`
- `apps\mcp-server\src\main.ts`
- `apps\mcp-server\src\schemas\dlp-guard.ts`
- `apps\mcp-server\src\telemetry.ts`
- `apps\mcp-server\src\tools\__tests__\build_validation_explanation.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_contract_validity.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_cost_guard.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_dem_det.test.ts`

**Documentation files sampled:**
- `.hermes\plans\auto-20260614-013800.md`
- `.vercel\README.txt`
- `20260613_cross_validation_report.md`
- `20260613_dsv_waybill_port_plan.md`
- `20260613_job_store_mcp_fix_plan.md`
- `20260613_p2_gap_design.md`
- `20260614_api_inventory_design_audit_v1.md`
- `20260614_db_schema_swarm_scout.md`
- `20260614_documentation_audit_swarm_scout.md`
- `20260614_performance_optimization_plan_v1.md`
- `20260614_phase2_plan.md`
- `20260614_phase3_4_work_log.md`

**Config/build files sampled:**
- `.claude\settings.local.json`
- `.codex\root-docs-scan.json`
- `.codex\root-docs-write.json`
- `.github\dependabot.yml`
- `.github\workflows\_ts-checks.yml`
- `.github\workflows\codeql.yml`
- `.github\workflows\fly-mcp-server-deploy.yml`
- `.github\workflows\fly-worker-deploy.yml`
- `.github\workflows\python-worker-ci.yml`
- `.github\workflows\release-gate.yml`
- `.github\workflows\reliability.yml`
- `.github\workflows\secret-scan.yml`

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
- Code/config/doc/agent inventory counts: code=259, docs=157, config=520, agent_profiles=0.
- Follow-up verification should confirm that newly added text matches actual implementation paths listed above.


## Codex Documentation Update — 2026-06-14T20:22:02.604306+00:00

**Update policy:** existing content above this section is preserved. This section was appended after scanning code, documentation, config, and agent profile files.

**Purpose:** This section records the documentation refresh event without altering earlier changelog entries.

### Evidence inventory

**Source/code files sampled:**
- `apps\mcp-server\db\migrate-rate-cards.sql`
- `apps\mcp-server\db\seed-rate-cards.sql`
- `apps\mcp-server\src\__tests__\router.test.ts`
- `apps\mcp-server\src\__tests__\schema-contract.test.ts`
- `apps\mcp-server\src\db.ts`
- `apps\mcp-server\src\main.ts`
- `apps\mcp-server\src\schemas\dlp-guard.ts`
- `apps\mcp-server\src\telemetry.ts`
- `apps\mcp-server\src\tools\__tests__\build_validation_explanation.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_contract_validity.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_cost_guard.test.ts`
- `apps\mcp-server\src\tools\__tests__\check_dem_det.test.ts`

**Documentation files sampled:**
- `.hermes\plans\auto-20260614-013800.md`
- `.vercel\README.txt`
- `20260613_cross_validation_report.md`
- `20260613_dsv_waybill_port_plan.md`
- `20260613_job_store_mcp_fix_plan.md`
- `20260613_p2_gap_design.md`
- `20260614_api_inventory_design_audit_v1.md`
- `20260614_db_schema_swarm_scout.md`
- `20260614_documentation_audit_swarm_scout.md`
- `20260614_performance_optimization_plan_v1.md`
- `20260614_phase2_plan.md`
- `20260614_phase3_4_work_log.md`

**Config/build files sampled:**
- `.claude\settings.local.json`
- `.codex\root-docs-dryrun-latest.json`
- `.codex\root-docs-scan.json`
- `.codex\root-docs-write.json`
- `.github\dependabot.yml`
- `.github\workflows\_ts-checks.yml`
- `.github\workflows\codeql.yml`
- `.github\workflows\fly-mcp-server-deploy.yml`
- `.github\workflows\fly-worker-deploy.yml`
- `.github\workflows\python-worker-ci.yml`
- `.github\workflows\release-gate.yml`
- `.github\workflows\reliability.yml`

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
- Code/config/doc/agent inventory counts: code=263, docs=164, config=526, agent_profiles=0.
- Follow-up verification should confirm that newly added text matches actual implementation paths listed above.
