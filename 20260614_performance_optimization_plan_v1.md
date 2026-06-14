# SCT Ontology — Performance Optimization Plan v1
**SWARM PLAN (Performance Track)** | 2026-06-14 | Agent: SWARM-PLAN-perf
**Scope:** apps/web, apps/mcp-server, apps/worker-py, packages/*

---

## 1. Batch MCP Tool Calls — Eliminate N+1 (CRITICAL)

**Current State:**
`cf-mcp-client.ts:106-188` — `classify_type_b`, `check_rate_card`, `check_evidence_required`, `check_hs_uae_compliance` called inside per-line `for` loops. A 100-line invoice = 400+ sequential dispatches despite in-process execution. Each call still pays zod validation cost (avg ~0.3ms) and async overhead.

**Root Cause:**
Tool schemas (`tools.ts:52-55`, `tools.ts:124-129`) enforce single-line signatures (`line_id: z.string()`). No batch variant exists. `dispatch()` is single-call by design.

**Target State:**
| Tool | Batch Variant | Wire Change |
|---|---|---|
| `classify_type_b` | `classify_type_b_batch({lines: [{line_id, description}]})` | 1 call × N lines |
| `check_rate_card` | `check_rate_card_batch({checks: [{charge_code, lane, rate}]})` | 1 call × N lines |
| `check_evidence_required` | `check_evidence_required_batch({lines: [{line_id, charge_code, present_evidence}]})` | 1 call × N lines |
| `check_hs_uae_compliance` | Filter CUSTOMS lines first, batch if >0 | 0-1 call |

**Implementation:**
Add batch tools to `tools.ts` that accept `z.array(...)` input, loop internally, and return `{results: [...]}`. Original single-line tools preserved for MCP-server compatibility. `cf-mcp-client.ts:validate()` calls batch variants.

**Expected Improvement:**
- 100-line invoice: 400 → ~6 dispatch calls (**98.5% reduction**)
- Latency: ~800ms → ~150ms (`tools.ts` call overhead ~0.3ms × 400 → ~0.3ms × 6)
- **P95 latency improvement: 80%+**

**Effort:** 3-4 hours (medium). 4 new batch tool entries + client plumbing.
**Risk:** Low. Batch schema must match single-line tool contracts. Add contract tests in `cf-mcp-client.test.ts`.

---

## 2. DB Connection Pooling Optimization (HIGH)

**Current State:**
Three separate `pg.Pool` instances sharing the same `DATABASE_URL`:
- `apps/mcp-server/src/db.ts:30` — Pool(max=10)
- `apps/web/src/lib/mcp/db.ts:25` — Pool(max=10, duplicate copy)
- `apps/web/src/lib/job-store-pg.ts:21` — Pool(max=10, with SSL)

Each has `max=10`, idleTimeout=30s, but no shared metrics. In Vercel serverless, each cold start creates 3 pools = 30 connections per function instance. No monitoring for pool exhaustion, wait-time, or query latency.

**Target State:**
1. **Single shared pool** via a `@sct/shared` package exposing `getPool()` with singleton
2. Pool metrics exposed via `Pool.on('connect')`, `Pool.on('acquire')`, `Pool.on('remove')` → structured logs
3. Environment-based tuning:
   - `PG_POOL_MAX`: 20 (production), 5 (dev)
   - `PG_IDLE_TIMEOUT_MS`: 10,000 (Vercel serverless — release fast)
   - `PG_CONNECT_TIMEOUT_MS`: 3,000
   - `PG_STATEMENT_TIMEOUT`: 10,000 (kill slow queries)
4. `pool.query()` wrapper with latency histogram (p50/p95/p99)

**Expected Improvement:**
- Connection count: 30 → 20 per instance (**33% reduction**)
- Idle connection cleanup: 30s → 10s (**faster release in serverless**)
- Query latency visibility: **0 → full histogram**

**Effort:** 4-5 hours (high). Extract to shared package, update 3 consumers, add pool instrumentation.
**Risk:** Medium. Pool singleton must be Vercel-serverless-safe (lazy init, no cross-request pollution). Test with concurrent requests.

---

## 3. Caching Strategy (HIGH)

**Current State:**
- Cloudflare Worker has KV cache (`wrangler.toml:19-21`) — but only for the Worker, not web app
- `fx-check.ts:27` calls `STORE.listFxPolicies()` on every currency conversion — full table scan, no cache
- `tools.ts:188-197` — `check_rate_card` hits Postgres on every line, no rate card cache
- `tools.ts:68-76` — `classify_type_b` keyword-matches in memory (already fast)

**Target State:**

| What | TTL | Invalidation | Expected Hit Rate |
|---|---|---|---|
| FX policies (`listFxPolicies`) | 15 min | `createFxPolicy()` → invalidate | 95%+ |
| Rate cards (by charge_code) | 10 min | Admin API → invalidate | 90%+ |
| `classify_type_b` memo | Duration of request | None needed (in-memory Map) | 100% |
| Evidence index per invoice | Request duration | None needed | Already memoized |

**Implementation:**
1. Add `lru-cache` (zero-dependency, 1KB) to `fx-check.ts` — cache `listFxPolicies()` result with 15-min TTL
2. Add `lru-cache` to `tools.ts:runCheckRateCard` — cache per charge_code+lane, 10-min TTL, max 500 entries
3. Per-request `Map<string, string>` for `typeBByLine` (already exists at `cf-mcp-client.ts:108`) — no change needed

**Expected Improvement:**
- FX policy lookup: DB query per line → 1 DB query per 15 min (**99% reduction** for multi-line)
- Rate card lookup: DB query per line → cache hit (90%+) → **0.5ms → 0.01ms** per call
- Total validate(): remove ~2N queries from hot path

**Effort:** 2-3 hours (medium). 2 cache instances, test invalidation.
**Risk:** Low. Stale cache worst-case = stale rate check (AMBER), not false PASS. Add `X-Cache: HIT/MISS` to response headers for debugging.

---

## 4. CI Pipeline Optimization (MEDIUM)

**Current State:**
No `.github/workflows/*.yml` found — CI is either configured in another repo or relies on `npm run verify` manually. The `docs/SYSTEM_ARCHITECTURE.md:20` references `ci.yml` and `hvdc-verify.yml` but they are not in the current repo.

**Target State:**
1. Single CI file with **matrix** parallelization (not sequential `needs`)
2. Job split:
   ```
   lint → typecheck → test (parallel by package) → build → deploy-preview
   ├─ apps/web tests
   ├─ apps/mcp-server tests
   └─ packages/contracts validation
   ```
3. Test sharding: `vitest --shard=1/3` for apps/web (26 test files)
4. Cached `node_modules` via `actions/cache@v4`
5. Bundle analysis artifact on PR (`@next/bundle-analyzer`)

**Expected Improvement:**
- CI wall-clock: sequential → parallel matrix (**60-70% reduction**)
- Dev feedback loop: faster fail on lint/typecheck before running full suite

**Effort:** 2 hours (medium). Write `ci.yml` from scratch or locate existing CI.
**Risk:** Low. Standard GitHub Actions pattern.

---

## 5. Build Optimization

**Current State:**
`next.config.js` — minimal config, no bundle optimization, no tree-shaking hints, no SWC minification tuning. Python worker Dockerfile installs ~200MB of `openjdk-21-jre-headless` (line 80) for future OpenDataLoader that isn't used yet.

**Target State:**

### Web (Next.js)
```js
// next.config.js additions:
{
  compiler: { removeConsole: process.env.NODE_ENV === 'production' },
  swcMinify: true,
  modularizeImports: { 'lucide-react': { transform: 'lucide-react/dist/esm/icons/{{member}}' } },
  productionBrowserSourceMaps: false,
  output: 'standalone' // smaller Vercel deployment
}
```

### Worker-Py Dockerfile
- Remove `openjdk-21-jre-headless` + `fonts-noto-cjk` from runtime stage (lines 79-80)
- Remove `JAVA_HOME`, `OPENDATALOADER_HOME` env vars (lines 85-86)
- Save ~200MB in image size (if OpenDataLoader is truly future, add it when activated)

**Expected Improvement:**
- Next.js bundle: ~5-10% reduction via `modularizeImports` + console removal
- Docker image: ~300MB → ~100MB (**66% reduction**)
- Cold start (worker-py): faster pull + unpack

**Effort:** 1.5 hours (low). Config changes + Dockerfile cleanup.
**Risk:** Low for web. Worker-py: confirm OpenDataLoader is not in active use via grep.

---

## 6. API Response Optimization

**Current State:**
- `run/route.ts:179` — returns full JSON with all line results, no pagination
- `export/route.ts:16` — workbook generation is synchronous, blocks request
- No response compression (Next.js default `gzip` likely enabled but not verified)
- No streaming support for large exports

**Target State:**
1. **Pagination for large result sets**: `run/route.ts` — if lines > 50, return first 50 with `cursor` for next page
2. **Async export**: `export/route.ts` — move workbook generation to background, return `202 Accepted` with job URL, poll for completion
3. **Compression**: Verify `Content-Encoding: gzip` via middleware/Next.js config
4. **Streaming**: `GET /api/audit/trace` — stream large trace logs as NDJSON instead of buffering full array

**Expected Improvement:**
- Response size: full JSON → paginated (50 lines × payload) → **50-90% smaller per request**
- Export route: blocking 3-5s → 202 Accepted in <200ms

**Effort:** 3 hours (medium). Pagination cursor + async export + streaming endpoint.
**Risk:** Medium. Cursor pagination must handle concurrent modifications (use `updated_at` as cursor).

---

## 7. Worker/Parser Performance

**Current State:**
- `parser-client.ts:29-47` — single `fetch()` per parse. PDF parsing is synchronous in Python worker. No parallel evidence parsing.
- `run/route.ts:92-111` — evidence PDFs parsed sequentially with `for...of` (line 92)
- No `.keepalive` on outgoing HTTP connections to parser

**Target State:**
1. **Parallel evidence parsing**: `run/route.ts:92` — `Promise.all(evidenceFiles.map(f => parser.parsePdfText(...)))` instead of sequential `for...of`
2. **HTTP keep-alive**: Reuse connection pool via `undici` or Node.js `http.Agent({keepAlive: true})` in `parser-client.ts`
3. **Timeout**: Add `AbortController` with 30s timeout per parse call (prevents hanging requests)
4. **PDF pre-check**: Skip parsing for PDFs <1KB (corrupt/empty)

**Expected Improvement:**
- 5 evidence PDFs: sequential ~2.5s → parallel ~0.6s (**75% reduction**)
- Connection reuse: eliminate TCP handshake per call

**Effort:** 1.5 hours (low). Promise.all + keep-alive + timeout.
**Risk:** Low. `Promise.all` is standard. Watch for resource exhaustion (max 10 concurrent parse calls via `p-limit`).

---

## 8. Frontend Performance (Next.js)

**Current State:**
`next.config.js:7` — no `images`, no `headers`, no `stale-while-revalidate`, no ISR. All pages likely SSR-only. No bundle analysis.

**Target State:**
```js
// next.config.js additions:
{
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() { return [{ source: '/api/:path*', headers: [
    { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=300' }
  ]}]; },
  experimental: { optimizePackageImports: ['lucide-react'] }
}
```

Additionally:
- Audit page: SSG with ISR revalidate=60 for frequently-accessed routes
- Add `@next/bundle-analyzer` for CI artifacts
- Lazy-load `workbook-builder.ts` (308 lines, used only in export route) via `dynamic(() => import(...))`

**Expected Improvement:**
- Lighthouse Performance score: baseline → +10-15 points
- Static pages: TTFB <50ms (served from edge/CDN)
- First-load JS: reduced via dynamic import of workbook-builder (~5KB gzipped)

**Effort:** 2 hours (medium). Config + lazy-load + ISR enablement.
**Risk:** Low. ISR: verify no auth leaks on cached pages.

---

## 9. Monitoring & Instrumentation (OpenTelemetry)

**Current State:**
- Cloudflare Worker has OpenTelemetry → Axiom (`wrangler.toml:10-11`, `observability-runbook.md:1-112`)
- web app, mcp-server, python worker: **zero instrumentation**
- No performance budgets, no alert thresholds for API routes
- `console.error` scattered without structured logging

**Target State:**
1. **@vercel/otel** for apps/web — auto-instrument Next.js routes, DB queries, fetch calls
2. **OpenTelemetry SDK** for apps/mcp-server — trace all tool calls + DB queries
3. **Python OpenTelemetry** for worker-py — trace parse duration, PDF size, error rates
4. **Performance budgets** in CI:
   - API P95 latency: <500ms
   - Cold start: <2s
   - Validate (100 lines): <2s
   - Export generation: <5s
5. **Structured logging**: Replace `console.error` with JSON-structured logs including `{traceId, jobId, duration_ms, tool}`

**Expected Improvement:**
- Visibility: zero → full distributed tracing across all 4 services
- MTTD (Mean Time To Detect): unknown → <5 min (Axiom alerts)
- Performance regression detection: manual → automated (CI budget gates)

**Effort:** 5-6 hours (high). SDK integration across 3 runtimes + CI budget jobs.
**Risk:** Medium. OTEL overhead ~1-3% on latency. Sample at 10% in production initially.

---

## 10. Load Testing Strategy

**Current State:**
No load testing exists. Unknown capacity limits:
- How many concurrent invoice validations before timeout?
- Parser worker saturation point?
- Postgres connection pool exhaustion threshold?

**Target State:**
1. **k6 load test scripts** — target key endpoints:
   - `POST /api/invoice-audit/run` — 10 concurrent × 50 lines
   - `POST /api/audit/export` — 5 concurrent × 50 lines
   - `GET /api/audit/trace/:jobId` — 50 concurrent
   - `POST /mcp` (Worker) — 100 concurrent tool calls
2. **Load profiles**: Smoke (1 VU), Average (10 VU × 5min), Stress (ramp to 100 VU), Soak (20 VU × 30min)
3. **Thresholds**: 
   - http_req_failed < 1%
   - http_req_duration P95 < 2s
   - no connection pool exhaustion errors
4. **Run in CI**: Smoke test on PR, average on merge to main, stress/soak weekly

**Expected Improvement:**
- Known capacity before production incidents
- Regression detection: any PR that increases P95 by >20% fails CI

**Effort:** 3 hours (medium). Write k6 scripts, set thresholds, CI integration.
**Risk:** Low. Load tests run against staging/preview, never production.

---

## Priority Matrix

| # | Item | Impact | Effort | Risk | Priority |
|---|---|---|---|---|---|
| 1 | Batch MCP tool calls | CRITICAL | Medium | Low | **P0 — Week 1** |
| 2 | DB connection pooling | HIGH | High | Medium | **P0 — Week 1** |
| 3 | Caching strategy | HIGH | Medium | Low | **P0 — Week 1** |
| 7 | Parallel evidence parsing | HIGH | Low | Low | **P1 — Week 1** |
| 8 | Frontend perf (bundle/lazy) | MEDIUM | Medium | Low | **P1 — Week 2** |
| 5 | Build optimization | MEDIUM | Low | Low | **P1 — Week 2** |
| 4 | CI pipeline | MEDIUM | Medium | Low | **P1 — Week 2** |
| 6 | API response (paginate/async) | MEDIUM | Medium | Medium | **P2 — Week 3** |
| 9 | Monitoring instrumentation | HIGH | High | Medium | **P2 — Week 3** |
| 10 | Load testing | MEDIUM | Medium | Low | **P2 — Week 3** |

---

## Regression Risk Summary

| Risk | Mitigation |
|---|---|
| Batch tools return different shape → client breaks | Keep single-line tools; batch is additive. Add contract test. |
| Pool singleton in Vercel serverless | Lazy init per request via globalThis (pattern already used in `job-store.ts:217-219`) |
| Stale cache → false PASS | AMBER on cache miss (not PASS). TTL short (10-15 min). Invalidation hooks. |
| Parallel evidence parsing overloads parser worker | Cap at 10 concurrent via `p-limit`. Parser worker already runs uvicorn with multiple workers. |
| OTEL overhead degrades latency | 10% sampling in production initially. Observe for 1 week before raising. |
| k6 load tests hit production | Scripts point to `env.preview` URL only. Guard via `K6_TARGET_URL` env var. |

---

## Dependencies & Blockers

- **Shared PG pool package** (item #2): Requires monorepo workspace setup or a `packages/db` extraction — currently no workspace exists (`apps/web` and `apps/mcp-server` are independent). Defer to Week 2.
- **CI pipelines** (item #4): If CI exists in a separate repo, link it. Otherwise write from scratch in this repo.
- **OpenDataLoader JRE** (item #5): Confirm with engineering team before removing from Dockerfile.

---

**Next action:** Start with Item #1 (Batch MCP tools) — highest impact, lowest complexity, enables Items #3 and #7.
