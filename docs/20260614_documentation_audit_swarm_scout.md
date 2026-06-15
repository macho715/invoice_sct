# Documentation Quality Audit — SWARM SCOUT Report

> **Audit date:** 2026-06-14 | **Scope:** 130+ .md files across root, docs/, domestic/, shpiment/ | **Method:** Full read of 40+ key docs, code-doc grep (.ts/.py), git log analysis

## EXECUTIVE SUMMARY

**Overall documentation health: 4.6/10 — RED (requires major remediation)**

The project has two distinct code architectures documented simultaneously:
1. **OLD** (2026-05): Cloudflare Worker MCP + ChatGPT App (`server/src/`, `public/`, `data/corpus/`)
2. **CURRENT** (2026-06): Invoice Audit Platform (`apps/web/`, `apps/worker-py/`, `apps/mcp-server/`)

**Critical finding:** 70% of core docs (SYSTEM_ARCHITECTURE, LAYOUT, GUIDE, QA_REPORT, observability-runbook) describe the OLD architecture. The README.md is the ONLY doc reflecting the current 3-app structure.

Code-to-doc traceability is further damaged by auto-appended "Codex Documentation Update" sections that add 50-200 lines of evidence inventory to every core doc without updating the actual content above.

---

## 1. DOCUMENTATION INVENTORY

### Core Docs (root + docs/) — Completeness Scores

| Document | Modified | Score | Verdict |
|----------|----------|-------|---------|
| README.md | 2026-06-14 | 8/10 | BEST doc — current architecture, setup, verification, routes. Only doc reflecting reality |
| docs/CHANGELOG.md | 2026-06-14 | 9/10 | BEST maintained — SESS-005 detailed, accurate, verified. Codex bloat at bottom |
| docs/SPEC.md | 2026-05-10 | 7/10 | WRONG PRODUCT — v0.1.0 ChatGPT App spec, not Invoice Audit Platform. Good structure |
| docs/PLAN.md | 2026-05-10 | 7/10 | WRONG PRODUCT — "Corpus-only RAG MVP" plan. Contains "aniwer" typos, dead tool references |
| plan.md | 2026-06-14 | 6/10 | DUAL-PURPOSE — top=SESS-005 sync plan, bottom=Codex evidence inventory |
| pdf.md | 2026-06-14 | 7/10 | RECENT — NotebookLM PDF pipeline, good technical depth |
| plan-20260614-notebooklm-pdf.md | 2026-06-14 | 7/10 | RECENT — Phase 1 approved |
| plan_mcp-vercel-inprocess.md | 2026-06-14 | 7/10 | RECENT — implemented |
| docs/SECURITY_PRIVACY.md | 2026-05-10 | 6/10 | ACCURATE but missing invoice-audit-specific DLP/P2 masking |
| docs/QA_REPORT.md | 2026-05-18 | 6/10 | OUTDATED — 302 tests (now 368), Widget v10 context, not invoice audit |
| plan_doc-guardian-gate-merge.md | 2026-06-13 | 6/10 | ACCURATE — code references valid |
| 20260613_cross_validation_report.md | 2026-06-13 | 8/10 | HISTORICAL but ACCURATE — 9-gate coverage |
| 20260613_p2_gap_design.md | 2026-06-13 | 6/10 | HISTORICAL — now implemented |
| 20260613_dsv_waybill_port_plan.md | 2026-06-13 | 6/10 | HISTORICAL — now implemented |
| 20260613_job_store_mcp_fix_plan.md | 2026-06-13 | 5/10 | STALE — likely resolved |
| docs/SYSTEM_ARCHITECTURE.md | 2026-06-14 | 5/10 | **STALE** — describes old `server/src/` CF Worker, not `apps/web+mcp+worker-py` |
| docs/LAYOUT.md | 2026-06-14 | 5/10 | **STALE** — maps old `server/src/`, `public/`, `data/`; 70% of directory map outdated |
| docs/GUIDE.md | 2026-06-13 | 5/10 | **STALE** — CF Worker dev workflow (`wrangler`), not `apps/web` Vercel workflow |
| docs/observability-runbook.md | 2026-06-13 | 5/10 | **STALE** — Axiom/wrangler for old CF Worker |
| docs/ROUTE_DECISION.md | 2026-06-13 | 4/10 | **IRRELEVANT** — `/ontology/resolve` routing for old endpoint |
| docs/CODEX_SETUP.md | 2026-06-13 | 5/10 | STALE — references `.agents/skills/` not present |
| docs/CONNECT_CHATGPT.md | 2026-06-13 | 5/10 | STALE — CF Worker MCP connector, not current app |
| docs/CONNECT_CLAUDE.md | 2026-06-13 | 3/10 | STALE — pre-dates current architecture |
| docs/claude-plan-20260511.md | 2026-05-11 | 4/10 | STALE — "kept as history" |
| docs/SPEC_IMPROVEMENTS.md | 2026-05-13 | 5/10 | STALE — "ChatiPT" typos, dead tool refs |
| docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md | 2026-06-13 | 5/10 | STALE — DSV GPT Actions, not current platform |
| docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md | 2026-06-13 | 5/10 | STALE — execution plan for above |
| docs/cursor_graphify_knowledge_graph_feature.md | 2026-06-13 | 3/10 | STALE |
| docs/SCT_ONTOLOGY 개발 현황 보고서.md | 2026-06-13 | 6/10 | MIXED — comprehensive but describes 16-tool CF Worker |

### Subdirectory Docs Summary

| Directory | Files | Score Range | Overall |
|-----------|-------|-------------|---------|
| docs/plans/ | 16 | 3-7 | 4.5/10 — 80% stale/superseded |
| docs/operations/ | 7 | 3-6 | 4.0/10 — 100% stale (2026-05 era) |
| docs/superpowers/plans/ | 13 | 3-7 | 5.0/10 — Phase completion docs OK, rest stale |
| docs/superpowers/specs/ | 8 | 3-6 | 4.5/10 — mostly pre-architecture |
| docs/traceability/sct-card/ | 9 | 5-7 | 6.0/10 — good for old architecture |
| docs/traceability/wh-status/ | 2 | 5/10 | STALE |
| docs/archive/ | 3 | 3/10 | INTENTIONALLY archived |
| docs/uiux/ | 2 | 4/10 | STALE — v1/v2 spec from 2026-05-10 |
| domestic/runtime/ | 11 | 2-4 | 2.5/10 — PATCH_NOTES dump, low value |
| shpiment/ | 9+ | 4-6 | 5.0/10 — well-maintained but separate package docs |

---

## 2. STALE / INACCURATE DOCUMENTS (CRITICAL LIST)

### P0 — Architecturally wrong (must rewrite, not update)

1. **docs/SYSTEM_ARCHITECTURE.md** — Describes `server/src/worker.ts` CF Worker architecture. Current: 3-app platform. 70% of content is Codex auto-bloat.
2. **docs/LAYOUT.md** — Maps `server/src/`, `public/`, `data/corpus/`, `wh status/`. Current layout: `apps/web`, `apps/worker-py`, `apps/mcp-server`, `packages/`, `migrations/`.
3. **docs/GUIDE.md** — Commands: `npm run worker:deploy`, `wrangler`. Current: `pnpm dev`, `pnpm test`, `pnpm build` in `apps/web`.
4. **docs/observability-runbook.md** — References Axiom, `wrangler secret put`, `hvdc-mcp-prod` dataset. Current: Vercel + Neon + Fly.io monitoring.
5. **docs/ROUTE_DECISION.md** — `/ontology/resolve` endpoint routing. Irrelevant. Suggest archive.

### P1 — Wrong product context (rewrite or archive)

6. **docs/SPEC.md** — ChatGPT App v0.1.0 spec. Good template but wrong product. Replace with Invoice Audit Platform spec.
7. **docs/PLAN.md** — "Corpus-only RAG MVP" plan from 2026-05-10. Persists "aniwer" typos, references dead tools.
8. **docs/QA_REPORT.md** — Widget v10, Decision Card, PII/NDA tests (2026-05-18). Nothing about invoice audit testing (368 tests, 14 MCP tools).
9. **docs/SPEC_IMPROVEMENTS.md** — "ChatiPT" typos, operational improvements for ChatGPT App.
10. **docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md + EXECUTION_PLAN.md** — DSV GPT Actions improvement, ontology layer spec superseded by current platform.
11. **docs/CONNECT_CHATGPT.md** — CF Worker MCP connector. Current: Vercel production URL.

### P2 — Historical / superseded (candidates for archive)

12. **docs/claude-plan-20260511.md** — Self-documented as "kept as history."
13. **docs/CODEX_SETUP.md** — References non-existent `.agents/skills/`.
14. **docs/cursor_graphify_knowledge_graph_feature.md** — Legacy feature spec.
15. **docs/operations/ (all 7 files)** — All date from 2026-05. SDK patches, template render specs.
16. **docs/plans/decision-card-v2-*.md (4 files)** — Decision Card v2 design, superseded.
17. **docs/plans/HVDC_Dual_MCP_Ontology_Implementation_Plan_final.md** — Historical.
18. **docs/plans/20260514_*.md** — 1 month old upgrade reports.
19. **docs/plans/plan-2026-05-12-auto-sct-ontology-email-draft.md** — Email draft from May.
20. **docs/superpowers/specs/2026-05-*.md** (2 files) — Pre-architecture specs.
---

## 3. MISSING DOCUMENTATION GAPS (P0/P1/P2)

### P0 — Critical gaps (must be created)

| Gap | Rationale |
|-----|-----------|
| **API Reference** | No document listing all API endpoints (9 routes in README but no request/response schemas, error codes, auth) |
| **Deployment Guide** | No doc covering Vercel deploy, Neon Postgres setup, Fly.io MCP deploy, environment variable matrix |
| **Database Schema Reference** | 8+ migration files exist but no single schema doc. Rate cards, job store, audit traces tables undocumented |
| **Onboarding Guide** | No doc for new developers. Which app to start? What are the dependencies? |
| **Invoice Audit Platform SPEC** | Current SPEC.md is ChatGPT App spec. No invoice audit functional spec exists |
| **Invoice Audit Platform ARCHITECTURE** | SYSTEM_ARCHITECTURE.md is old CF Worker. No doc describing `apps/web + worker-py + mcp-server` interaction |

### P1 — High priority gaps

| Gap | Rationale |
|-----|-----------|
| **Troubleshooting Guide** | GUIDE.md has 5 troubleshooting rows for old CF Worker. No invoice-audit-specific troubleshooting |
| **Testing Strategy** | No document explaining test pyramid (368 tests across 3 apps), test commands per app, coverage expectations |
| **DSV Waybill Field Mapping** | Implemented in code (`dsv_waybill.py`) but no reference doc for 8 core functions |
| **14 MCP Tools Reference** | README mentions "14 audit tools" but no tool-by-tool reference (inputs, outputs, verdict semantics) |
| **P2 Data Classification Matrix** | SECURITY_PRIVACY.md covers P0/P1/P2 levels but not specific to invoice data fields |

### P2 — Nice-to-have gaps

| Gap | Rationale |
|-----|-----------|
| **Architecture Decision Records (ADRs)** | No record of key decisions: why Vercel+Neon+Fly.io, why Python parser worker, why in-process MCP |
| **Glossary** | HVDC domain terms (BOE, BL, DN, DEM/DET, TYPE-B, HS/UAE) scattered across docs |
| **Contributing Guide** | Missing CONTRIBUTING.md |
| **Release Process** | No doc describing the release pipeline (GitHub Actions gates, Vercel deploy, Fly.io deploy) |
| **Rate Card Design** | `rate_cards` seed script exists but no doc explaining 20 records, 6 charge types, HVDC rate structure |

---

## 4. CONTRADICTIONS BETWEEN DOCUMENTS

| Contradiction | Docs Involved | Detail |
|--------------|---------------|--------|
| Architecture model | README vs SYSTEM_ARCHITECTURE | README: 3 apps (web+mcp+worker-py). ARCH: single CF Worker (server/src/) |
| Tool count | README vs SCT 개발 현황 보고서 vs CHANGELOG | README: 14 tools. 개발현황: 16 tools. CHANGELOG: 11→14 |
| Test count | README vs QA_REPORT | README: 368 (95+186+107). QA_REPORT: 302 (22 files) |
| Deployment target | README vs GUIDE vs observability | README: Vercel+Neon+Fly. GUIDE: `wrangler deploy`. observability: Axiom |
| Test commands | README vs GUIDE | README: `pnpm --dir apps/web typecheck`. GUIDE: `npm run typecheck` |
| MCP endpoint | CONNECT_CHATGPT vs ROUTE_DECISION | CHATGPT: `/mcp`. ROUTE: `/ontology/resolve` vs `/mcp/ontology/resolve` |
| Project name | Various | "HVDC Ontology Grounded ChatGPT App" vs "SCT Invoice Audit Platform" vs "SCT_ONTOLOGY" |
| plan.md vs README | plan.md describes shpiment sync. README describes invoice audit platform | Dual identity confusion |

---

## 5. DUPLICATE CONTENT

| Pattern | Files |
|---------|-------|
| "Codex Documentation Update — Evidence inventory" | Injected into SYSTEM_ARCHITECTURE, LAYOUT, CHANGELOG, PLAN.md, README — same 50-200 line appendix in 5+ files |
| shpiment docs duplicated | `shpiment/` and `shpiment/DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL/` have identical 00_README, 01_GPT, 02_COMBINED, PRIVATE_INTERNAL |
| Plan/approval structure | `plan.md`, `plan-20260614-notebooklm-pdf.md`, `plan_doc-guardian-gate-merge.md`, `20260613_p2_gap_design.md`, `docs/operations/plan.md` all use identical "Phase 1: Business Review → 1.1 문제 정의 → 1.2 제안 옵션 → 1.3 추천 → 1.4 승인" template |
| SCT improvement docs | `SCT_ONTOLOGY_IMPROVEMENT_SPEC.md` + `SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md` + `SPEC_IMPROVEMENTS.md` — 3 docs covering same topic |
| Invoice Audit Platform v1.00 | Exists in both `docs/sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` AND `docs/superpowers/plans/2026-06-10-invoice-audit-platform-v1.00.md` |
| UI/UX specs | `docs/uiux/` has v1 AND v2 of same spec |
| Archive docs | `docs/archive/plan.md` + `docs/archive/root-originals/` overlap with active docs |

---

## 6. CODE DOCUMENTATION AUDIT

### TypeScript (.ts): 50+ files sampled in mcp-server/tools and web/lib

| Metric | Finding |
|--------|---------|
| JSDoc coverage | **~5%** — Only 3 files in `mcp-server/src/tools/` have JSDoc (`/**`). `apps/web/src/lib/` has 7 JSDoc blocks across 4 files |
| Function documentation | Near zero. Most functions lack `@param`, `@returns`, `@throws` |
| Module-level comments | `lib/mcp/tools.ts` and `lib/mcp/db.ts` have module-level JSDoc. Others do not |
| Schema documentation | Zod schemas in tools lack inline documentation |
| Test documentation | Test files use descriptive `describe`/`it` names (acceptable) but no JSDoc on test utilities |

### Python (.py): All files in worker-py/app/

| Metric | Finding |
|--------|---------|
| Module docstrings | **~90% coverage** — Nearly every `.py` file has a module-level `"""` docstring |
| Function docstrings | **~60%** — Route handlers, validators, parsers have good docstrings. DB helpers, middleware are well-documented |
| FR compliance comments | Good — `numeric_integrity.py` cites FR-020a, `audit_log.py` cites FR-025 |
| Parser documentation | Strong — `xlsx.py`, `md.py`, `pdf_text.py`, `dsv_waybill.py`, `txt.py` all have clear module docstrings |

### Overall code-doc score

| Language | Module-Level | Function-Level | FR Traceability | Overall |
|----------|-------------|----------------|-----------------|---------|
| Python | 9/10 | 6/10 | 8/10 | **7.5/10** |
| TypeScript | 1/10 | 1/10 | 2/10 | **1.5/10** |

---

## 7. CONSOLIDATION RECOMMENDATIONS

### MERGE candidates

| Merge | Rationale |
|-------|-----------|
| `docs/SPEC_IMPROVEMENTS.md` + `SCT_ONTOLOGY_IMPROVEMENT_SPEC.md` + `SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md` | Same topic (SCT ontology improvement), consolidate to one |
| Duplicate shpiment docs | Keep `shpiment/` root copies, remove `shpiment/DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL/` duplicates |
| UI/UX specs v1 + v2 | Keep v2 only, or remove v1 |
| `docs/sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` + `docs/superpowers/plans/2026-06-10-invoice-audit-platform-v1.00.md` | Same content, different location |

### ARCHIVE candidates (move to docs/archive/ or delete)

| File | Reason |
|------|--------|
| `docs/claude-plan-20260511.md` | Self-declared "kept as history" — already acknowledged as archival |
| `docs/operations/` (entire directory) | All 7 files from 2026-05, SDK patches, obsolete |
| `docs/plans/decision-card-v2-*.md` (4 files) | Superseded Decision Card design |
| `docs/plans/HVDC_Dual_MCP_Ontology_Implementation_Plan_final.md` | Historical |
| `docs/plans/20260514_*.md` | 1 month old upgrade reports |
| `docs/plans/plan-2026-05-12-auto-sct-ontology-email-draft.md` | Stale email draft |
| `docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md` | 27 days old |
| `docs/cursor_graphify_knowledge_graph_feature.md` | Legacy feature |
| `docs/ROUTE_DECISION.md` | Irrelevant route decision |
| `20260613_job_store_mcp_fix_plan.md` | Resolved bug fix plan |
| `domestic/runtime/` (all 11 files) | PATCH_NOTES dump, not useful for current platform |
| dupe invoice audit platform: `docs/sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` | Duplicate |
| `docs/CODEX_SETUP.md` | References non-existent skills |
| `docs/superpowers/agent-exports/` | Generated artifacts, not human docs |

### REWRITE candidates (keep name, replace content)

| File | New Content |
|------|-------------|
| `docs/SYSTEM_ARCHITECTURE.md` | 3-app platform: Vercel Next.js + Fly.io MCP + Python worker, Neon Postgres, Vercel Blob |
| `docs/LAYOUT.md` | Map `apps/`, `packages/`, `migrations/`, `scripts/`, `docs/` structure |
| `docs/GUIDE.md` | Invoice audit web app workflow, not CF Worker |
| `docs/SPEC.md` | Invoice Audit Platform functional spec |
| `docs/PLAN.md` | Current platform roadmap, not "Corpus-only RAG MVP" |
| `docs/QA_REPORT.md` | 368 tests, 14 MCP tools, current verification baseline |
| `docs/observability-runbook.md` | Vercel + Neon + Fly.io monitoring |
| `docs/CONNECT_CHATGPT.md` | Current connector URL: `sct-ontology-invoice-audit.vercel.app` |
| `docs/SECURITY_PRIVACY.md` | Add DLP gate, P2 masking, invoice-audit-specific data classification |

### REMOVE Codex auto-bloat

All core docs ending with `## Codex Documentation Update — 2026-*` sections containing evidence inventories (file lists) should be stripped. These sections add 50-200 lines of non-actionable metadata to SYSTEM_ARCHITECTURE, LAYOUT, CHANGELOG, PLAN.md, and others. They do not improve documentation quality and cause staleness.

---

## 8. PRIORITY ACTION PLAN

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Rewrite `docs/SYSTEM_ARCHITECTURE.md` for current 3-app platform | 2h | Critical — blocks all architecture understanding |
| **P0** | Rewrite `docs/LAYOUT.md` for current directory structure | 1h | Critical — blocks navigation |
| **P0** | Create `docs/API_REFERENCE.md` | 3h | Critical — 9 routes undocumented |
| **P0** | Create `docs/DEPLOYMENT.md` | 2h | Critical — no deployment doc |
| **P0** | Rewrite `docs/GUIDE.md` for invoice audit workflow | 1.5h | Critical — wrong commands |
| **P1** | Strip Codex auto-bloat from all docs | 0.5h | High — reduces doc size 20-40% |
| **P1** | Archive 20+ stale docs (list above) | 0.5h | High — declutter |
| **P1** | Create `docs/INVOICE_AUDIT_SPEC.md` | 3h | High — product spec missing |
| **P1** | Create `docs/MCP_TOOLS_REFERENCE.md` | 2h | High — 14 tools undocumented |
| **P1** | Merge duplicate + consolidate 5 doc clusters | 1h | Medium |
| **P2** | Add JSDoc to TS tool files (14 tools in mcp-server) | 4h | Medium — code-doc gap |
| **P2** | Create `docs/ARCHITECTURE_DECISIONS.md` | 2h | Low |
| **P2** | Create `docs/GLOSSARY.md` | 1h | Low |
| **P2** | Rewrite `docs/QA_REPORT.md` for current platform | 1.5h | Medium |

**Total estimated effort:** ~26h for full remediation.

---

## 9. METRICS SUMMARY

| Metric | Value |
|--------|-------|
| Total .md files scanned | 130+ |
| Core docs (root+docs/) | 28 |
| Core docs that are ACCURATE | 3 (README, CHANGELOG, pdf.md) |
| Core docs that are STALE/WRONG | 17 (61%) |
| Core docs that are MIXED/OK | 8 (29%) |
| Archived/obsolete docs (candidate removal) | 25+ |
| Duplicate doc clusters | 6 |
| Cross-doc contradictions | 8 |
| Plan documents without completion status | 5 |
| Python code-doc score | 7.5/10 |
| TypeScript code-doc score | 1.5/10 |
| Overall documentation health | **4.6/10** |

---

*Report generated by SWARM SCOUT agent. Next step: deploy PLAN agent to create remediation roadmap for P0 items.*
