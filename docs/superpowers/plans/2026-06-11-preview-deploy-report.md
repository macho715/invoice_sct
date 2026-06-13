# Preview Deploy 운영 가용성 보고서 (2026-06-11)

**Status**: 🟡 STAGED — Pending Operational Execution
**Owner**: backend
**Last updated**: 2026-06-11

---

## 1. Status

| Item | State |
|---|---|
| Pre-deploy gates (verify, dry-run, build) | ✅ Ready (vitest 392/392, pytest 36/36, wrangler dry-run, pip-audit strict all PASS 2026-06-11) |
| `wrangler.toml` `[env.preview]` block | ✅ Added (lines 48-77) |
| `scripts/deploy_preview.ps1` | ✅ Created (48 lines) |
| `scripts/e2e_preview.mjs` | ✅ Created (128 lines) |
| Operational execution (Task 6) | ⏳ Pending — requires `CF_API_TOKEN`, `VERCEL_TOKEN`, Vercel project binding |

## 2. Why Task 6 is Not Yet Executed

- Local environment lacks Cloudflare API token (`CF_API_TOKEN`)
- Local environment lacks Vercel API token (`VERCEL_TOKEN`)
- No Vercel project is linked to `apps/web` (`vercel link` not run)
- Preview D1 database, KV namespace, R2 bucket are placeholder IDs (require real Cloudflare resource creation)
- These setup steps are out of scope for the implementation plan (they are environment prerequisites, not code tasks)

## 3. Execution Steps When Environment is Ready

Run from `c:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main`:

```bash
# 1. Replace placeholder IDs in wrangler.toml
#    preview-kv-id-placeholder, preview-d1-id-placeholder
#    → real IDs from `wrangler kv:namespace create preview` and `wrangler d1 create hvdc-mcp-audit-preview`

# 2. Link Vercel project
vercel link --yes

# 3. Run deploy + E2E
pwsh -NoProfile -File scripts/deploy_preview.ps1
```

## 4. 5 Success Criteria (will be evaluated on actual deploy)

| # | Criterion | Test point |
|---|---|---|
| 1 | Upload 200 OK + job_id 발급 | `e2e_preview.mjs` criterion[0] |
| 2 | Parse → JSON with invoice_lines ≥ 1 | `e2e_preview.mjs` criterion[1] |
| 3 | SCT validate → verdict ∈ {PASS, AMBER, ZERO} | `e2e_preview.mjs` criterion[2] |
| 4 | Approval + xlsx export (200/200) | `e2e_preview.mjs` criterion[3] |
| 5 | xlsx SHA-256 hash captured | `e2e_preview.mjs` criterion[4] |

## 5. Risks (deferred to execution time)

- **R1**: OAuth 미연동으로 `X-User-Role` dev header 의존 (preview 만 적용)
- **R2**: 4.5MB payload 한도 미실측 (small invoice 만 검증)
- **R3**: Vercel preview Next.js cold start 5s+ 지연 → 첫 E2E timeout 가능, retry 1회
- **R4**: D1 preview binding placeholder IDs 미교체 시 MCP-bridge in-memory fallback 만 동작

## 6. References

- Implementation plan: `docs/superpowers/plans/2026-06-11-preview-deploy.md`
- Spec: `docs/superpowers/specs/2026-06-11-preview-deploy-design.md`
- 5 sibling plan-studio docs: `D1~D5-*-2026-06-11.md`
- Phase X 운영 가동 검증 (local dev): `docs/superpowers/plans/Phase X 운영 가동 검증 완료.MD`
