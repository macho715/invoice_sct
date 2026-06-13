# System Architecture

## System Purpose

This project is the HVDC ontology-grounded ChatGPT App and MCP server. It answers HVDC logistics questions from approved ontology corpus evidence, renders structured Decision Card / Case Status Card UI, and serves the runtime from Cloudflare Workers.

The current public MCP endpoint is `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`. The current widget resource is `ui://hvdc/answer-card-v10.html`.

## Components

| Component | Evidence path | Runtime role |
| --- | --- | --- |
| Cloudflare Worker | `server/src/worker.ts`, `wrangler.toml` | Handles `/healthz`, `/mcp`, D1 lookup, R2 protected file boundary, rate limits, and telemetry config. |
| MCP tool registry | `server/src/hvdc-server.ts` | Registers ChatGPT Apps SDK resources and tools including ontology search, validation, Dual-MCP tools, and `get_hvdc_case_status`. |
| Answer pipeline | `server/src/answer.ts`, `server/src/corpus.ts`, `server/src/router.ts` | Routes questions, searches corpus chunks, validates evidence, and returns structured answer payloads. |
| Decision Card contract | `server/src/decision-card.ts`, `server/src/types.ts` | Builds Decision Card v2.1 payloads, rulepack trace fields, human gate state, and security/audit status. |
| Widget UI | `public/hvdc-answer-widget.html`, `server/src/generated/widget-html.ts` | Renders ChatGPT iframe UI, Case Status Card, Decision Card tabs, drawers, tables, and fallback text. |
| Corpus bundle | `data/corpus/`, `scripts/generate_worker_assets.py`, `server/src/generated/corpus-data.ts` | Converts approved ontology documents into Worker-bundled search data. |
| WH status SSOT | `wh status/hvdc_wh_status.xlsx`, `scripts/seed_wh_status_d1.py`, `migrations/0006_wh_status_case_card.sql`, `migrations/0007_case_event_ssot.sql` | Projects Excel case rows into D1 case cards, canonical events, warehouse dwell, and site intake status. |
| Verification | `tests/`, `.github/workflows/ci.yml`, `.github/workflows/hvdc-verify.yml` | Runs typecheck, Vitest, Worker dry-run, coverage, schema drift, and corpus drift gates. |

```mermaid
graph LR
  User["ChatGPT / Claude / Cursor"] --> Worker["Cloudflare Worker /mcp"]
  Worker --> Tools["MCP tool registry"]
  Tools --> Answer["Answer pipeline"]
  Tools --> CaseStatus["get_hvdc_case_status"]
  Answer --> Corpus["Generated ontology corpus"]
  CaseStatus --> D1["Cloudflare D1 WH status / audit"]
  Worker --> R2["Cloudflare R2 protected files"]
  Worker --> Widget["ui://hvdc/answer-card-v10.html"]
  Widget --> Cards["Decision Card / Case Status Card"]
  Tests["npm run verify / CI"] --> Worker
```

## Runtime Flow

1. A client calls `/mcp` with a tool request.
2. `server/src/worker.ts` creates the Worker request boundary and runtime bindings.
3. `server/src/hvdc-server.ts` dispatches the selected MCP tool.
4. Ontology answers read generated corpus data; case status answers read D1 Control Tower / WH status projections.
5. The tool returns structured content plus `ui://hvdc/answer-card-v10.html` for ChatGPT rendering.
6. The widget renders cards without mutating business verdict fields.

## External Dependencies

- Cloudflare Workers for runtime hosting.
- Cloudflare D1 binding `MCP_AUDIT_DB` for audit, Control Tower, and warehouse status projections.
- Cloudflare R2 binding `HVDC_FILES` for protected upload/write storage.
- Cloudflare KV binding `HVDC_CACHE` for cache support.
- ChatGPT Apps SDK metadata via MCP resources.

## Current Verification Baseline

- `npm run worker:deploy` executed `npm run verify` before deployment.
- Latest verified test baseline: 22 test files, 302 tests passed.
- Latest deployed Worker URL: `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`.
- Latest smoke evidence: `/healthz` returned 200 and `get_hvdc_case_status caseNo=207721` returned `WHCASE-207721`, `WARN`, `M100_FINAL_DELIVERED`, `canonicalEvents=6`, and `caseCard=36`.


## Codex Documentation Update — 2026-06-13T18:20:29.442785+00:00

**Update policy:** existing content above this section is preserved. This section was appended after scanning code, documentation, config, and agent profile files.

**Purpose:** This section reflects detected source, config, and agent components as an architecture inventory.

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
flowchart TB
  subgraph Repository
    SRC[Source files] --> CFG[Config/build files]
    CFG --> DOC[Root documentation]
    AG[Agent profiles] --> DOC
  end
  DOC --> QA[Doc-code alignment verification]
```

### Verification notes

- Append-only update generated by `root-docs-batch-update`.
- Code/config/doc/agent inventory counts: code=171, docs=99, config=264, agent_profiles=0.
- Follow-up verification should confirm that newly added text matches actual implementation paths listed above.
