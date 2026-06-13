# HVDC Ontology Project — Upgrade Scout Report

**Generated**: 2026-05-14
**Mode**: Lite (in-context evidence)
**Scope**: 운영 Cloudflare Worker MCP + 로컬 Python/Fuseki 참조 구현 통합 평가

---

## 1. Executive Summary

HVDC 프로젝트는 **두 개의 분리된 코드베이스**를 운영 중이다: 운영 Cloudflare Worker MCP(11 tools, claude.ai 연결 ✅)와 로컬 Python/Fuseki 참조 구현(`ontology-insight-upgrade/`). 핵심 자산(SPARQL 쿼리·CostGuard 룰·감사 체인)은 **로컬에 묶여 있고 운영 MCP에서 호출 불가**하다. 가장 큰 업그레이드 기회는 **"로컬→Worker 브릿지"** 구축으로, 매일 발생하는 인보이스 감사·OOG 식별·DEM/DET KPI 작업을 claude.ai에서 직접 호출 가능하게 만드는 것이다. 부수적으로 **nested Git 깨짐 복구**와 **README 정직성 개선**(Phase 1 진행 중)이 시급하다.

---

## 2. Current State Snapshot

| 영역 | 현재 상태 | Pain Point |
|------|---------|-----------|
| **운영 MCP** | Cloudflare Worker, 11 tools, claude.ai ✅ | 모두 텍스트 RAG 기반, 실시간 데이터 무 |
| **로컬 Fuseki** | localhost:3030, OFCO/DSV/PKGS/PAY 그래프 | 외부 노출 안 됨, ngrok 임시 |
| **비즈니스 룰** | `hvdc_rules.py` (CostGuard/HS/Cert) | Python only, MCP 미연동 |
| **NLQ→SPARQL** | regex 기반, localhost:5010 | 운영에서 호출 불가 |
| **감사 체인** | NDJSON + SHA-256 hash | 로컬 파일, 운영 audit 부재 |
| **Git 상태** | nested repo `fatal: bad object HEAD` | 커밋 증거 사용 불가 |
| **GSD Phase** | Phase 1 계획 완료, 미실행 | source/generated 분류 미완 |
| **테스트** | 120/120 vitest 통과 | E2E (Worker→Fuseki) 부재 |
| **CI/CD** | GitHub Actions 참조용 | 운영 자동 배포 없음 |
| **문서** | 두 README 톤 불일치 | 마케팅 vs 정직 톤 혼재 |

**Stack**:
- TypeScript / Node 20 (Cloudflare Worker, MCP SDK 1.20, Zod 4, wrangler 4.90)
- Python 3.11 (Flask, Apache Jena Fuseki 4.10)
- Cloudflare R2 (`hvdc-ontology-files`) + D1 (`hvdc-mcp-audit`, id=`5a934620-…`)

---

## 3. Upgrade Ideas Top 10

| # | Idea | Bucket | Imp | Eff | Risk | Conf | **Score** | Evidence |
|---|------|--------|-----|-----|------|------|-----------|----------|
| 1 | Cloudflare Tunnel → Fuseki 브릿지 | Architecture | 5 | 3 | 3 | 5 | **2.78** | E1, E2 |
| 2 | `invoice_risk_scan` MCP tool 추가 | DX/Tooling | 5 | 2 | 2 | 5 | **6.25** | E3, E4 |
| 3 | Phase 1 GSD 실행 (source hygiene) | Docs/Process | 4 | 2 | 1 | 5 | **10.00** | E5, E6 |
| 4 | Nested Git repo 복구 또는 clean clone | Reliability | 4 | 1 | 2 | 5 | **10.00** | E5 |
| 5 | `costguard_check` + `po_invoice_match` | DX/Tooling | 5 | 2 | 2 | 4 | **5.00** | E3, E7 |
| 6 | E2E 테스트 (Worker→Fuseki 라이브) | Reliability | 4 | 3 | 2 | 4 | **2.67** | E8 |
| 7 | D1 audit log mirror (운영 감사) | Security | 4 | 3 | 3 | 4 | **1.78** | E2, E9 |
| 8 | NLQ→SPARQL을 `ask_hvdc_ontology`에 주입 | Performance | 4 | 3 | 3 | 3 | **1.33** | E3, E10 |
| 9 | README 두 폴더 동기화 (정직 톤) | Docs/Process | 3 | 1 | 1 | 5 | **15.00** | E11 |
| 10 | OAuth scope 정리 (read vs write 분리) | Security | 4 | 3 | 3 | 4 | **1.78** | E1, E12 |

**Score 산식**: `(Impact × Confidence) / (Effort × Risk)`

---

## 4. Best 3 Deep Report

### 🥇 Best #1 — Phase 1 GSD 실행 (Source Hygiene)

**Score: 10.00 | Bucket: Docs/Process**

**Goal**:
- 소스/생성/런타임 파일 분류 완료
- nested Git 깨짐을 file-hash-only fallback으로 회피
- 레거시 surface(ngrok/GPTs Actions/local Flask)에 "non-production" 마킹

**Non-goals**: Cloudflare Worker 변경, MCP tool 추가, Fuseki 재배포

**Proposed Design**:
```
docs/SOURCE-HYGIENE.md          ← 분류표 + Git fallback 모드
docs/PUBLIC-SURFACE-BOUNDARY.md ← Cloudflare MCP만 운영
docs/AUDIT-EVIDENCE-BOUNDARY.md ← 로컬 vs 운영 감사 분리
docs/VERIFICATION-REPORTING-RULES.md ← warnings ≠ PASS
scripts/verify-source-hygiene.ps1 ← 자동 검증
.gitignore                      ← artifacts/, logs/, fuseki/data/
+ 5개 레거시 파일 헤더 마킹
```

**PR Plan** (3 PRs):
1. `docs(01): source/generated boundary` — Tasks 1, 2 (분류 + Git fallback)
2. `docs(01): legacy surface markers` — Tasks 3, 4 (PUBLIC-SURFACE + AUDIT 경계)
3. `chore(01): verification gate + summary` — Tasks 5, 6 (PowerShell self-check + SHA-256)

**Tests**: `verify-source-hygiene.ps1` deterministic, 6개 requirement ID 커버

**Rollout**: 즉시 적용 가능 (read-only 문서 작업), 롤백 = Git revert (단, Git 깨진 상태에선 파일 삭제로 대체)

**Risks & Mitigations**:
1. Git 깨짐 → SHA-256 해시 증거 사용
2. 레거시 헤더 추가가 기존 사용자 혼란 → "참조용" 명시 유지
3. 분류 누락 → Phase 2 진입 전 audit
4. 자동 PR 생성 불가 → 수동 PR
5. CONTEXT.md 누락 → ASSUMPTION 명시

**KPI**:
- 6/6 requirement IDs PASS
- `verify-source-hygiene.ps1` exit 0
- 5개 레거시 파일 헤더 100% 적용

---

### 🥈 Best #2 — `invoice_risk_scan` MCP Tool (Daily Use)

**Score: 6.25 | Bucket: DX/Tooling**

**Goal**:
- claude.ai에서 "OFCO 5월 인보이스 리스크 보여줘" → 실시간 Fuseki SELECT 결과
- VAT 누락/음수금액/누락 날짜/Zero VAT 5가지 자동 탐지
- evidence_link로 PDF 원본 페이지 추적

**Non-goals**: 인보이스 수정, 승인 플로우, 자동 이메일

**Proposed Design**:
```typescript
// server/src/tools/invoice-risk-scan.ts
invoice_risk_scan({
  supplier?: "OFCO"|"DSV"|"MAMMOET",
  date_from?: string, date_to?: string
}) → fetch(TUNNEL_URL + "/sparql", {
  method: "POST",
  body: queries/03-invoice-risk-analysis.rq
}) → 결과를 risk card로 렌더링
```

**Data flow**:
```
claude.ai → Worker MCP → Cloudflare Tunnel → Fuseki :3030 → SPARQL 결과
       ↑                                                          ↓
    risk card ← validate_answer ← parsed JSON ←─────────────────┘
```

**PR Plan** (3 PRs):
1. `feat(infra): cloudflared tunnel for fuseki` — tunnel.yaml + wrangler service binding
2. `feat(mcp): invoice_risk_scan tool` — schema + handler + tests
3. `feat(mcp): card renderer for risk results` — `render_hvdc_answer_card` 확장

**Tests**:
- Unit: SPARQL 결과 → risk card 변환 정확성
- Integration: tunnel 연결 + 실제 Fuseki 5건 fixture
- E2E: claude.ai mcp-remote → Worker → tunnel → Fuseki round-trip
- Security: SPARQL injection 방어 (date_from 파라미터 검증)

**Rollout**:
- Phase 1: dev environment에서 tunnel + 1 tool 테스트
- Phase 2: 운영 Worker에 staging tool 추가 (`/mcp/staging`)
- Phase 3: 정식 머지, claude.ai 재연결
- Rollback: Worker rollback to previous version (1 minute)

**Risks & Mitigations**:
1. Tunnel 다운 → graceful fallback to "service unavailable" 카드
2. SPARQL injection → Zod schema strict, 파라미터화된 쿼리
3. Fuseki 응답 지연 → Worker timeout 10초, retry 1회
4. 잘못된 데이터 노출 → PII 마스킹 기존 파이프라인 재사용
5. claude.ai 캐시 → 새 채팅 강제 안내

**KPI**:
- claude.ai 응답 시간 < 5초 (P95)
- 5종 risk type 100% 탐지율 (fixture 기준)
- 일일 호출 ≥ 5회 (실 사용 검증)

---

### 🥉 Best #3 — README Honesty Sync

**Score: 15.00 | Bucket: Docs/Process**

**Goal**:
- 두 README(`Ontology insight upgrade/` vs `ontology-insight-upgrade/`) 톤 일치
- "100% 통과", "엔터프라이즈급" 등 과장 표현 제거
- 운영 MCP URL과 로컬 참조 surface 명확 분리

**Non-goals**: 기능 변경, 새 도구 추가

**Proposed Design**:
- `ontology-insight-upgrade/README.md`를 source of truth로 채택
- `Ontology insight upgrade/README.md`를 동일 톤으로 재작성
- 두 README 상단에 "현재 상태" 표 통일
- ChatGPT runtime → claude.ai runtime 표기 수정

**PR Plan** (3 PRs):
1. `docs: adopt new README tone in legacy folder`
2. `docs: update privacy policy runtime reference`
3. `docs: cross-link two README with status table`

**Tests**: 마크다운 lint, link checker

**Rollout**: 즉시, 롤백 = git revert (Git 복구 후)

**Risks**: 외부 사용자 혼란 가능 → CHANGELOG에 명시

**KPI**:
- 두 README diff <50 lines
- 과장 표현 0개 (`ripgrep "100%|엔터프라이즈급|보장"` 검색)

---

## 5. Options A/B/C

| Option | 범위 | Risk | Time |
|--------|------|------|------|
| **A 보수** | Best #1 + #3만 (문서 정리) | 낮음 | 2일 |
| **B 중간 (권장)** | A + Best #2 (`invoice_risk_scan`) | 중간 | 1주 |
| **C 공격** | B + Top10 #5, #6, #7 (3개 추가 tool + E2E + D1 audit) | 높음 | 3주 |

---

## 6. 30/60/90-day Roadmap

### Day 1~7 (Sprint 1)
- D1: Phase 1 GSD 실행 → `verify-source-hygiene.ps1` PASS
- D2: nested Git 복구 (clean clone 또는 reflog 복구)
- D3: README 동기화 PR 머지
- D4~5: Cloudflare Tunnel 설정 + Fuseki 연결 검증
- D6~7: `invoice_risk_scan` 1개 tool prototype

### Day 8~30 (Sprint 2)
- `costguard_check`, `po_invoice_match`, `case_timeline` 3개 tool 추가
- E2E 테스트 (Worker→Tunnel→Fuseki) 5개 시나리오
- 실 OFCO 5월 인보이스 1건 검증

### Day 31~60
- `oog_heavy_lift_scan`, `dem_det_monthly_kpi` 추가
- D1 audit log mirror (운영 감사 기록)
- NLQ→SPARQL을 `ask_hvdc_ontology`에 주입

### Day 61~90
- `cert_expiry_alert`, `draft_official_email`, `export_query_to_excel`
- OAuth scope 분리 (read vs write)
- production 모니터링 대시보드

---

## 7. Evidence Table

| ID | Source | Date | Why Relevant |
|----|--------|------|-------------|
| E1 | `wrangler.toml` (in-repo) | 2026-05-13 | Worker 운영 설정 + R2/D1 바인딩 확인 |
| E2 | Cloudflare Tunnel docs (developers.cloudflare.com/cloudflare-one/connections/connect-networks) | 2025+ | localhost 노출 표준 패턴 |
| E3 | `queries/03-invoice-risk-analysis.rq` (in-repo) | 2025-08-17 | 5종 risk 자동 탐지 SPARQL 검증됨 |
| E4 | `hvdc_api.py:run_rules` (in-repo) | 2025-08-18 | REST 엔드포인트 동작 확인 |
| E5 | `.planning/phases/01.../01-RESEARCH.md` (in-repo) | 2026-05-13 | Git fatal HEAD + file-hash fallback 결정 |
| E6 | `.planning/ROADMAP.md` (in-repo) | 2026-05-13 | 37 requirements 1:1 매핑 |
| E7 | `hvdc_rules.py:run_costguard` (in-repo) | 2025-08-18 | CLAUDE.md Δ 2/5/10% 임계값 일치 |
| E8 | `tests/descriptor.test.ts` (in-repo) | 2026-05-13 | 120/120 통과, E2E 라이브 부재 |
| E9 | `migrations/` D1 schema (in-repo) | 2026-05 | D1 운영 가능 확인 |
| E10 | `nlq_to_sparql.py:detect_intent` (in-repo) | 2025-08 | 6개 intent regex 매처 |
| E11 | 두 README diff (in-repo) | 2026-05 | 톤 불일치 정량 확인 |
| E12 | `MCP_AUTH_SCOPES = "files:upload files:write"` | 2026-05 | 현재 단일 scope 운영 |

> ⚠️ **AMBER_BUCKET**: 외부 웹 리서치 미수행. 모든 evidence가 in-repo 자료. 외부 검증 필요 시 Step 3 별도 실행 권장.

---

## 8. AMBER_BUCKET

- **외부 베스트프랙티스**: MCP server scaling, Cloudflare Worker observability — 별도 web search 필요
- **유사 프로젝트**: 다른 logistics MCP 사례 — 미조사
- **Apache Jena 4.10 EOL 일정**: 미확인

---

## 9. Verification Gate

| 항목 | 결과 |
|------|------|
| Best3 evidence ≥ 2 | ✅ PASS (각 2~3개) |
| Deep Dive PR plan ≥ 3 | ✅ PASS |
| Tests/Rollback/KPIs | ✅ PASS |
| Stack 호환성 | ✅ PASS (TS/Cloudflare/Python 모두 in-place) |
| Secret/PII 노출 | ✅ NONE |
| 외부 evidence 날짜 | ⚠️ AMBER (in-repo only) |

**최종 판정**: **GO (with AMBER caveat)** — 외부 베스트프랙티스 검증은 별도 web search 권장이나, in-repo 근거만으로도 Best #1, #3은 즉시 실행 안전. Best #2는 Cloudflare Tunnel 표준 패턴 기반이라 위험 낮음.

**Apply Gates**:
- Gate 0 (Dry-run): `wrangler deploy --dry-run` 통과 확인
- Gate 1 (Change list): PR별 files 명시됨
- Gate 2 (Approval): 사용자 승인 대기
- Gate 3 (Canary): `/mcp/staging` endpoint 활용
- Gate 4 (Rollback): wrangler rollback 1분 내

---

## 10. Open Questions

1. **Cloudflare Tunnel 결정**: `cloudflared` 자체 호스팅 vs `WARP Connector` 중 어느 쪽? (보안 정책 영향)
2. **Fuseki 운영 호스팅**: 영구 PC가 24/7 가동되는가? 아니면 Cloudflare D1 마이그레이션 검토?
3. **OAuth scope 분리 시기**: 지금(Best #2와 함께) vs 나중(별도 PR)?

---

**다음 추천 작업**: Option B 채택 → `$gsd-execute-phase 1` 즉시 실행 → Best #2 (`invoice_risk_scan`) 1주 내 prototype.

---

*Report generated by Claude Project Upgrade Scout v2.1 — 2026-05-14*
