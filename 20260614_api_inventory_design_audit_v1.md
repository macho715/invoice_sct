# SCT ONTOLOGY — API Inventory & Design Audit (SWARM SCOUT)

> **Generated**: 2026-06-14 | **Agent**: SWARM SCOUT 
> **Scope**: Next.js API routes, MCP Server tools, FastAPI Worker endpoints, Contracts conformance

---

## 1. Complete API Endpoint Catalog

### 1.1 Next.js API Routes (`apps/web/src/app/api/`)

| # | Method | Path | Input Schema | Output Schema | Auth | Rate Limit | Errors |
|---|--------|------|-------------|--------------|------|------------|--------|
| 1 | **POST** | `/api/fx-policy` | `FxPolicySchema` (Zod, shapes: currency, rate, date) | `{status, fx_policy}` | None | None | `INVALID_STATE`(400), `BAD_REQUEST`(400) |
| 2 | **GET** | `/api/fx-policy` | Query: none | `{policies: [...]}` | None | None | No error codes emitted |
| 3 | **POST** | `/api/invoice-audit/run` | `{job_id}` (manual parse) | `{job_id, status, verdict, action_items}` | None | None | `INVALID_STATE`,`JOB_NOT_FOUND`,`PARSE_FAILED`,`MCP_UNAVAILABLE`,`VALIDATION_FAILED` |
| 4 | **GET** | `/api/export/download` | Query: `job_id`, `export_type` | Binary .xlsx (Content-Disposition) | None (export gate) | None | `INVALID_STATE`,`JOB_NOT_FOUND`,`DLP_BLOCK`,`EXPORT_FAILED` |
| 5 | **POST** | `/api/audit/export` | `{job_id, kind}` (manual parse) | `{...exportResult, signed_url, kind}` (JSON) | None (export gate) | None | `INVALID_STATE`,`JOB_NOT_FOUND`,`EXPORT_FAILED`,`EXPORT_REPLAY_DETECTED` |
| 6 | **POST** | `/api/audit/approve` | `{job_id, approval_scope, acknowledgement_reason}` | `{approval_id, status, prism_kernel_proof_ref}` | Header: `x-user-role`, `x-user-id` (role-based gate) | None | `FORBIDDEN`,`INVALID_STATE`,`JOB_NOT_FOUND`,`BAD_REQUEST`,`UNAUTHORIZED_APPROVAL`,`HUMAN_GATE_REQUIRED` |
| 7 | **GET** | `/api/audit/trace` | Query: `job_id` | `{job_id, trace: [...]}` | None | None | `INVALID_STATE`,`JOB_NOT_FOUND` |
| 8 | **GET** | `/api/audit/result` | Query: `job_id` | `{job_id, verdict, line_results, action_items, pdf_source_data}` | None | None | `INVALID_STATE`,`JOB_NOT_FOUND` |
| 9 | **POST** | `/api/audit/result` | `{job_id, verdict, line_results?, action_items?, variance_aed?}` (manual parse) | `{job_id, verdict, line_results, action_items, variance_aed}` (201) | None | None | `INVALID_STATE` |
| 10 | **GET** | `/api/audit/status` | Query: `job_id` | `{job_id, status, verdict, last_step, progress, updated_at}` | None | None | `INVALID_STATE`,`JOB_NOT_FOUND` |
| 11 | **POST** | `/api/files/ingest` | FormData: `file`, `job_id?` | `{job_id, file_ids, status, sha256, blob_ref}` (201) | Header: `x-user-id` (optional) | None (4.5MB cap) | `STORAGE_AUTH_FAILED`,`NO_FILE`,`UNSUPPORTED_FILE_TYPE`,`UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD`,`JOB_NOT_FOUND`,`INVALID_STATE` |
| 12 | **POST** | `/api/files/ingest/large` | `{filename, mimeType, fileSize, jobId}` (JSON) | `{url/clientToken, pathname, access}` (200) | Header: `x-user-id` (optional) | 50MB cap | `invalid_json`,`invalid_body`,`unsupported_mime_type`,`handle_upload_failed` |
| 13 | **GET** | `/api/dev/blob/[...path]` | Path params: `path[]` | Binary blob (application/octet-stream) | `.dev-blob` guard (dev-only) | None | `FORBIDDEN`(403), `JOB_NOT_FOUND`(404) |

**Total**: 13 endpoints, 7x GET, 8x POST

### 1.2 MCP Server Tools (`apps/mcp-server/`)

| # | Tool Name | Version | Input Schema (Zod) | Output Schema (Zod) | DB Access | 
|---|-----------|---------|-------------------|--------------------|-----------|
| 1 | `route_question` | 0.2.0 | `{question:string, userRole:string}` | `{routed_to, confidence, rationale}` | No |
| 2 | `normalize_invoice_lines` | 0.2.0 | `{lines: [{line_id, description, qty?, rate?, amount, currency}]}` | `{normalized_lines, rejected_count}` | No |
| 3 | `check_duplicate_invoice` | 0.2.0 | `{vendor_hash?, invoice_no_hash?, vendor_id?, vendor_name?, invoice_no?, amount, issue_date?}` | `{verdict, duplicates[{invoice_id, job_id,...}], reason_code}` | Yes (invoices) |
| 4 | `match_shipment_reference` | 0.2.0 | `{shipment_ref?, job_number?, bl_number?, do_number?}` | `{verdict, matches[{shipment_ref, confidence, matched_via}]}` | Yes (shipments) |
| 5 | `check_rate_card` | 0.2.0 | `{charge_code, lane?, rate_basis?, effective_date?, applied_rate?}` | `{verdict, contracted_rate, applied_rate, variance_pct, reason_code}` | Yes (rate_cards) |
| 6 | `check_contract_validity` | 0.2.0 | `{vendor_hash, contract_id?, check_date}` | `{verdict, contract_id, valid_from, valid_to, reason_code}` | Yes (contracts) |
| 7 | `check_evidence_required` | 0.2.0 | `{line_id, charge_code, sct_code?, present_evidence}` | `{verdict, required_evidence, present_evidence, missing_evidence}` | No |
| 8 | `check_tax_vat` | 0.2.0 | `{line_id, amount, currency, vat_rate?}` | `{verdict, expected_vat, applied_vat, reason_code}` | No |
| 9 | `check_fx_policy` | 0.2.0 | `{from_currency, to_currency, amount, rate_date?}` | `{verdict, applied_rate, policy_rate, variance_pct, reason_code}` | No |
| 10 | `check_cost_guard` | 0.2.0 | `{invoiceNo, currency, lines[{lineNo,item,qty,rate,draftAmount,standardAmount?,currency,evidenceIds}]}` | `{verdict, line_findings[{lineNo,qty_x_rate,draftAmount,standardAmount,variance_pct,reason_code}]}` | No |
| 11 | `check_hs_uae_compliance` | 0.1.0 | `{line_id, charge_code, hs_code?, evidence_docs}` | `{verdict, boe_found, hs_code_valid, reason_code}` | No |
| 12 | `build_validation_explanation` | 0.2.0 | `{finding_id, rule_id, reason_code, line_id?, severity}` | `{explanation, recommended_action, reviewer_hint}` | No |
| 13 | `classify_type_b` | 0.1.0 | `{line_id, description}` | `{line_id, type_b (enum), confidence, matched_keyword}` | No |
| 14 | `check_dem_det` | 0.1.0 | `{line_id, charge_code, has_dates, has_tariff, has_free_time, has_invoice, is_final_settlement}` | `{verdict, missing_inputs, reason_code}` | No |

**Total**: 14 tools. MCP Server endpoints: `GET /health`, `POST /mcp` (JSON-RPC).

### 1.3 FastAPI Worker Endpoints (`apps/worker-py/app/`)

| # | Method | Path | Input Schema (Pydantic) | Output Schema (Pydantic) | Auth | Rate Limit |
|---|--------|------|------------------------|-------------------------|------|------------|
| 1 | **GET** | `/health` | None | `{status, version, timestamp}` | None | None |
| 2 | **GET** | `/health/live` | None | `{status, version, timestamp}` | None | None |
| 3 | **GET** | `/health/ready` | None | `{status, version, checks:{db,blob_storage,parsers,memory}, timestamp}` (200/503) | None | None |
| 4 | **POST** | `/parse` | `ParseRequest` (blob_ref,file_id,job_id,file_type,parser_version,blob_url) | `ParseResponse` (parse_result_id, job_id, file_id, normalized, source_data) | None | None |
| 5 | **POST** | `/parse/pdf-json` | `ParseRequest` (same, sets file_type='pdf_json') | `ParseResponse` (same) | None | None |
| 6 | **POST** | `/v1/export` | `ExportRequest` (13 sheet row arrays + job_id + generated_at?) | `ExportResponse` (job_id, manifest, file_content_base64) | None | None |

**Total**: 6 endpoints. CORS: `allow_origins=["*"]`, Audit log middleware applied.

---

## 2. Contracts Conformance Report

### 2.1 `packages/contracts/validation.schema.ts` — MCP_TOOL_LIST
**STATUS: OUTDATED (P0)**

```diff
Contract MCP_TOOL_LIST (11 tools):
  route_question, normalize_invoice_lines, check_duplicate_invoice,
  match_shipment_reference, check_rate_card, check_contract_validity,
  check_evidence_required, check_tax_vat, check_fx_policy,
  check_cost_guard, build_validation_explanation

Actual MCP tools (14 tools):
  + check_hs_uae_compliance    ← MISSING FROM CONTRACT
  + classify_type_b            ← MISSING FROM CONTRACT  
  + check_dem_det              ← MISSING FROM CONTRACT
```

`validateMcpToolList()` will report 3 extra tools. Contract must be updated to match.

### 2.2 `packages/contracts/export.schema.ts` — Sheet Contract
**STATUS: CONFORMANT** — Both export route builders (`workbook-builder.ts`, `export.py`) produce all 13 sheets in `SHEET_CONTRACT_V2` order.

### 2.3 `packages/contracts/invoice.schema.ts` — Invoice Types
**STATUS: CONFORMANT** — TypeScript exports (`@/lib/types`) and Python Pydantic models (`app/schemas.py`) align with the contract (Currency, RateBasis, Verdict, InvoiceHeader, InvoiceLine).

---

## 3. API Design Issues (Prioritized)

### P0 — Critical (blockers for production)
| ID | Issue | Location | Detail |
|----|-------|----------|--------|
| **P0-01** | **No authentication middleware** | All Next.js API routes | `x-user-role`/`x-user-id` headers are trust-based with no token verification. Any client can spoof any role. |
| **P0-02** | **MCP_TOOL_LIST contract stale** | `packages/contracts/validation.schema.ts:25-37` | Missing 3 tools (classify_type_b, check_dem_det, check_hs_uae_compliance). `validateMcpToolList()` would fail. |
| **P0-03** | **No rate limiting** | All Next.js + worker-py routes | No rate limit middleware. DOS-able endpoints: `/api/files/ingest`, `/api/invoice-audit/run`, `/parse`. |
| **P0-04** | **No CORS on Next.js API** | All routes under `apps/web/src/app/api/` | Worker-py has CORS, Next.js API does not. Cross-origin requests from browser clients will fail. |
| **P0-05** | **Inconsistent error format** | `/api/files/ingest/large/route.ts:45` | Uses `{error, message}` instead of `{code, message}` used by all other routes. Breaks client error handling. |

### P1 — High (consistency/performance)
| ID | Issue | Location | Detail |
|----|-------|----------|--------|
| **P1-01** | **N+1 sequential tool calls** | `cf-mcp-client.ts:107-173` | `classify_type_b`, `check_rate_card`, `check_evidence_required`, `check_hs_uae_compliance` called per-line sequentially. For a 100-line invoice = 400+ sequential tool calls. Should batch. |
| **P1-02** | **No pagination on list endpoints** | `fx-policy/route.ts` (GET), `audit/status/route.ts` (GET) | Entire collection returned. Risk of large payloads. |
| **P1-03** | **No idempotency keys** | All POST mutation endpoints | `POST /api/audit/export` has replay detection via `EXPORTS_MAP`, but `POST /api/files/ingest`, `POST /api/invoice-audit/run`, `POST /api/audit/approve` have none. |
| **P1-04** | **cf-mcp-client swallows errors silently** | `cf-mcp-client.ts:115-117,130-131,155,171-173,184-187` | Tool failures push `{status:'ERROR'}` to toolCalls but propagate no error to caller. Gateway verdicts may overstate confidence. |
| **P1-05** | **Missing input size limits** | All POST routes except `/files/ingest` | No body size limits on `/api/invoice-audit/run`, `/api/fx-policy`, `/api/audit/approve`. Prone to large payload attacks. |
| **P1-06** | **Direct buffer construction from untrusted base64** | `/api/audit/export/route.ts:107`, `export/download/route.ts:131` | `Buffer.from(base64, 'base64')` from worker response — no size validation before loading into memory. |
| **P1-07** | **Missing content-type enforcement** | `/api/fx-policy/route.ts` (POST), `/api/audit/result/route.ts` (POST) | Accept JSON but don't validate `Content-Type` header first — fallback parsing may accept unexpected formats. |

### P2 — Medium (observability/robustness)
| ID | Issue | Location | Detail |
|----|-------|----------|--------|
| **P2-01** | **No request logging middleware** | Next.js API | Worker-py has `AuditLogMiddleware`. Next.js API has no structured request logging. |
| **P2-02** | **No health check endpoint** | Next.js API | Worker-py has 3 health endpoints. Next.js has none. Operational blindspot. |
| **P2-03** | **`EXPORTS_MAP` is in-process memory** | `/api/audit/export/route.ts` + `/api/export/download/route.ts` | Won't survive serverless cold starts. Cross-instance cache miss fallback exists in download route but adds latency. |
| **P2-04** | **Dev stub leaks in production path** | `/api/dev/blob/[...path]/route.ts` | Guarded by `isDevStub()` but lives in production codebase. Should be stripped at build time. |
| **P2-05** | **JSON-RPC MCP endpoint lacks TLS check** | `mcp-server/src/main.ts` | `POST /mcp` has no built-in auth/DLP on the transport layer (only inside `tools/call`). |
| **P2-06** | **Python parse error handling leaks stack traces** | `worker-py/app/routes/parse.py` | `raise HTTPException(status_code=422, detail=f'PARSE_XLSX_FAILED: {e!s}')` — may expose internal paths. |

---

## 4. Missing Endpoints vs Spec/Plan

Based on `plan.md`, `20260613_mvp_hardening_complete_v2.md`, and functional inference:

| Missing Endpoint | Priority | Needed For | Status |
|-----------------|----------|------------|--------|
| `GET /api/audit/list` | P1 | Dashboard: list all jobs with filters (date, status, verdict) | Not implemented |
| `DELETE /api/audit/{job_id}` | P2 | Job cleanup, GDPR/data retention | Not implemented |
| `GET /api/audit/{job_id}/files` | P2 | List source files attached to a job | Not implemented |
| `POST /api/audit/{job_id}/annotate` | P2 | Human review: add notes/comments to a job | Not implemented |
| `PATCH /api/fx-policy/{id}` | P2 | Update existing FX policy | Not implemented |
| `DELETE /api/fx-policy/{id}` | P2 | Remove stale FX policy | Not implemented |
| `POST /api/webhook/shipment-status` | P2 | External DSV/ADNOC push: shipment ETA/BL ready | Not implemented |
| `GET /api/export/download/signed` | P3 | One-time signed download URL for external sharing | Not implemented |
| MCP tool: `check_po_matching` | P2 | PO reconciliation (plan mentions PO matching in DLP scope) | Not implemented |
| MCP tool: `check_incoterms` | P3 | Incoterms validation for charge allocation | Not implemented |

---

## 5. Security/Performance Concerns

### 5.1 Security
1. **Spoofable auth headers** (P0-01): `x-user-role` and `x-user-id` are plain headers with zero verification. Equivalent to no auth.
2. **No CORS policy** (P0-04): Any origin can call Next.js API from browser.
3. **No CSRF protection** on state-changing endpoints.
4. **DLP guard only at MCP layer** — Next.js API endpoints don't scan request bodies for PII.

### 5.2 Performance
1. **Sequential N+1 in validate()** (P1-01): Each line calls `classify_type_b` + `check_rate_card` + `check_evidence_required` sequentially. A 50-line invoice = 150+ sequential DB/http calls.
2. **No connection pooling timeout on worker-py** — `_fetch_blob` uses `httpx.Client(timeout=10.0)` per request.
3. **Vercel Blob HEAD/GET without retry** — single failure path.

### 5.3 Observability
- No structured logging (only `console.warn` in one place)
- No request IDs propagated across the call chain
- Trace step attribution is inconsistent (`'cf-mcp:toolName'` vs `'python-worker'` vs `'gate-bridge'`)

---

## 6. API Design Pattern Analysis

### 6.1 Naming Conventions
| Aspect | Status | Example |
|--------|--------|---------|
| Route path convention | **OK** | `/api/{resource}/{action}` (REST-like) |
| Error code format | **MIXED** | `SCREAMING_SNAKE` in most routes, `snake_case` in `/files/ingest/large` |
| Response envelope | **INCONSISTENT** | Some return flat `{field}`, others return `{result:{...}}` |
| Job ID naming | **OK** | `job_{uuid_short}` pattern uniform |

### 6.2 Error Response Format Summary

| Route | Error Format | HTTP Code Usage |
|-------|-------------|----------------|
| `fx-policy` | `{code, message, errors?}` | 400, 200 (no explicit error codes for GET) |
| `invoice-audit/run` | `{code, message}` | 202, 400, 404, 409, 422, 503 |
| `audit/approve` | `{code, message}` | 400, 403, 404, 409 |
| `audit/status` | `{code, message}` | 404, 409 |
| `audit/result` | `{code, message}` | 201, 400, 404, 409 |
| `audit/trace` | `{code, message}` | 404, 409 |
| `audit/export` | `{code, message}` | 200, 400, 404, 500 |
| `export/download` | `{code, message}` → Binary xlsx | 200, 400, 403, 404, 409, 500 |
| `files/ingest` | `{code, message, ...extra}` | 201, 400, 409, 413, 500 |
| `files/ingest/large` | **`{error, message}`** (WRONG) | 200, 400, 500 |
| `dev/blob/[...path]` | `{code, message}` | 200 (binary), 403, 404 |

**Issue**: `/files/ingest/large` uses `{error, message}` which mismatches all other routes using `{code, message}`.

### 6.3 Pagination
- **0 of 2** list endpoints implement pagination.
- `GET /api/fx-policy` returns all policies unbounded.
- `GET /api/audit/status` is single-resource.

---

## 7. Recommendations

### 7.1 Immediate (P0 — this sprint)
1. **Add NextAuth.js or API key middleware** to all Next.js API routes (fix P0-01)
2. **Update `validation.schema.ts`** MCP_TOOL_LIST to include `classify_type_b`, `check_dem_det`, `check_hs_uae_compliance` (fix P0-02)
3. **Add rate limiting** using `@upstash/ratelimit` or similar to all routes (fix P0-03)
4. **Add CORS middleware** to Next.js API (fix P0-04)
5. **Normalize error format** in `/files/ingest/large` to `{code, message}` (fix P0-05)

### 7.2 Short-term (P1 — next sprint)
6. **Batch MCP tool calls**: modify tool schemas to accept arrays (e.g., `classify_type_b` takes `lines[]` instead of `line_id+description` single)
7. **Add pagination** to `GET /api/fx-policy`
8. **Add idempotency keys** to `POST /api/invoice-audit/run`, `POST /api/files/ingest`
9. **Add body size limits** via Next.js `bodyParser.sizeLimit` config
10. **Implement `GET /api/audit/list`** for dashboard

### 7.3 Medium-term (P2 — backlog)
11. **Add Next.js `/api/health`** endpoint (db ping, blob readiness)
12. **Extract `EXPORTS_MAP` to durable storage** (Redis/Vercel KV) for cross-instance reliability
13. **Add structured request logging** to Next.js API (correlate with worker-py audit logs)
14. **Implement DELETE endpoints** for job/fx-policy lifecycle management
15. **Add webhook receiver** for external shipment status updates

### 7.4 Contract Governance
16. **CI gate**: add `validateMcpToolList()` check in pre-build/release to fail if tool list drifts
17. **CI gate**: validate error code format consistency across all route files
18. **CI gate**: enforce `export const runtime = 'nodejs'` on all route files

---

## 8. Summary Matrix

| Category | Count | Status |
|----------|-------|--------|
| Next.js API routes | 13 endpoints | 7 GET, 8 POST (2 files serve dual GET+POST) |
| MCP server tools | 14 tools | 4 DB-connected, 10 stateless |
| FastAPI worker routes | 6 endpoints | 3 health, 2 parse, 1 export |
| Contract files | 3 | 1 outdated (validation.schema.ts) |
| P0 issues | 5 | Auth, contract staleness, rate limiting, CORS, error format |
| P1 issues | 7 | N+1, pagination, idempotency, error swallowing, size limits, buffer safety, content-type |
| P2 issues | 6 | Logging, health, in-process state, dev stub, transport auth, error leaks |
| Missing endpoints | 10 | List, delete, annotate, webhook, signed URL, PO/incoterms tools |
| Rate limit presence | 0 of 19 endpoints | None |
| Auth presence | 2 of 19 endpoints | Header-based only (approve route full, ingest route partial) |
