# Phase 5 (Option C: Combined Reliability Baseline) 작업 내역

작성일: 2026-06-14  
기반 커밋: `1d9c652` (SWARM Phase 1-5 + P0 Fix: 50 agents, 405 tests PASS)  
Phase 5 계획서: `plan-20260614-phase5.md`

---

## 1. 목표

Phase 5 Option C = k6 부하 테스트 + OpenTelemetry(OTel) 계측 + DB 풀 압박 테스트 + CI 신뢰성 워크플로우

보안 제약 (변경 불가):
- `OTEL_ENABLED=true` 환경 변수가 없으면 모든 계측은 no-op
- Trace 속성에 P2 DLP 카테고리(요율·TRN·BOE·BL번호·컨테이너번호·PII·인보이스 금액·API 키) 절대 노출 금지
- 405-test 베이스라인 유지
- 기존 CI 동작 회귀 금지
- 기존 API 계약 변경 금지

---

## 2. 완료된 작업

### 2.1 k6 부하 테스트 (`load-tests/`)

| 파일 | 시나리오 | 내용 |
|------|---------|------|
| `load-tests/k6/invoice-audit-smoke.js` | 연기 테스트 | VU 1, 30초, 업로드→감사→내보내기 전체 흐름 |
| `load-tests/k6/invoice-audit-load.js` | 부하 테스트 | VU 최대 50, 5분, p95 < 3s SLO |
| `load-tests/k6/db-pool-pressure.js` | DB 풀 압박 | 동시 100 VU로 DB 연결 풀 고갈 관찰 |
| `load-tests/k6/mcp-route-smoke.js` | MCP 라우팅 | MCP 서버 endpoint 순회 |
| `load-tests/README.md` | 사용 가이드 | 실행법, 결과 해석, SLO 기준 |
| `load-tests/results/.gitkeep` | 결과 디렉터리 | `.gitignore`에서 제외 |

### 2.2 `packages/telemetry` 패키지 (신규)

**`packages/telemetry/package.json`**
- 패키지명: `@invoice-audit/telemetry`
- exports: `"./src/index.ts"` (빌드 스텝 없음, TypeScript 소스 직접 export)
- 의존성: `@opentelemetry/api ^1.9.0`, `sdk-node`, `auto-instrumentations-node`, `exporter-trace-otlp-http`, `resources`, `semantic-conventions`

**`packages/telemetry/src/index.ts`**
- `initTelemetry(serviceName)` — OTel SDK 부트스트랩 (OTEL_ENABLED guard)
- `shutdownTelemetry()` — graceful shutdown
- `getTracer(name)` — no-op 또는 실제 Tracer 반환
- `withSpan(tracer, name, attrs, fn)` — 범용 span wrapper
- `redactAttributes(attrs)` — P2 키 패턴 감지 → `[REDACTED]` 치환

P2 키 감지 패턴: `/rate|amount|price|cost|trn|boe|bl_|bol|container|vessel|email|phone|pii|password|secret|token|key/i`

**`packages/shared/trace-redact.ts`** (신규)
- `isP2AttributeKey(key)`, `redactTraceAttributes(attrs)` — 동일 P2 마스킹 로직 (패키지 공유용)

### 2.3 Web 앱 OTel 계측 (`apps/web/`)

**`apps/web/src/instrumentation.ts`** (신규 — Next.js 15 OTel hook)
- Next.js `register()` 훅으로 서버 사이드에서 `initTelemetry('sct-web')` 호출
- `OTEL_ENABLED !== 'true'`이면 즉시 return

**`apps/web/src/lib/telemetry.ts`** (신규)
- `withApiSpan<T>(spanName, attributes, fn)` — API 라우트용 span wrapper
- `currentTraceId()` — 현재 span의 traceId 반환 (에러 응답 포함 용도)
- `setSpanAttributes(attrs)` — 활성 span에 안전한 속성 추가
- `redactAttributes` import from `@invoice-audit/telemetry`

**`apps/web/package.json`** 수정
- `"@invoice-audit/telemetry": "workspace:*"` 추가
- `"@opentelemetry/api": "^1.9.0"` 추가

### 2.4 MCP 서버 OTel 계측 (`apps/mcp-server/`)

**`apps/mcp-server/src/telemetry.ts`** (신규)
- `initMcpTelemetry()` — `initTelemetry('sct-mcp-server')` 래핑
- `withToolSpan(toolName, attrs, fn)` — MCP 툴 실행 span wrapper
- `currentTraceId()` — 현재 traceId

**`apps/mcp-server/src/main.ts`** 수정
- `initMcpTelemetry()` 호출 추가 (서버 시작 시)

**`apps/mcp-server/package.json`** 수정
- `"@opentelemetry/api": "^1.9.0"` 추가
- `pnpm install --filter "@invoice-audit/mcp-server"` 실행 완료

### 2.5 Worker-py OTel 계측 (`apps/worker-py/`)

**`apps/worker-py/app/telemetry.py`** (신규)
- `init_telemetry(service_name)` — opentelemetry-sdk 부트스트랩 (OTEL_ENABLED guard)
- `get_tracer(name)` — Tracer 반환 (no-op or real)
- `span(name, attrs)` — sync context manager
- `async_span(name, attrs)` — async context manager
- `current_trace_id()` — 현재 traceId
- P2 키 자동 마스킹 (속성 설정 시)

**`apps/worker-py/app/main.py`** 수정
- 시작 시 `init_telemetry('sct-worker-py')` 호출 추가

**`apps/worker-py/pyproject.toml`** 수정
- `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-fastapi` 추가

### 2.6 DB 풀 압박 테스트 (`apps/web/tests/`)

**`apps/web/tests/db-pool-pressure.test.ts`** (신규 — 5개 Vitest 테스트)
- `createJob()`/`getJob()` 동시 100 요청 풀 고갈 테스트
- 연결 타임아웃 회복 테스트
- 풀 크기 설정 반영 테스트
- 오류 격리 테스트 (한 쿼리 실패가 다른 연결에 영향 없음)
- idle 타임아웃 후 재연결 테스트

### 2.7 CI 신뢰성 워크플로우

**`.github/workflows/reliability.yml`** (신규)
- `k6-smoke` job: k6 설치 → smoke 시나리오 실행 (staging URL 대상)
- `db-pool-tests` job: `pnpm test --filter "@invoice-audit/web" tests/db-pool-pressure.test.ts`
- 트리거: push to main, PR to main, 주 1회 cron
- `OTEL_ENABLED: 'false'` (CI에서는 trace 미전송)

---

## 3. 해결 완료 (2026-06-14 업데이트)

### 3.1 플래키 테스트 — 해결됨

**`apps/web/tests/api-export-download.test.ts`** — `"success download of excel bytes"` 테스트가 **간헐적으로** 403 `DLP_BLOCK` 반환 (플래키, 재현율 약 20~30%)

**확정된 근본 원인** (15회 반복 실행으로 검증):
- 최소 PASS job의 워크북에서 **유일한 가변 셀은 `job_id`** (`job_` + 12 hex chars, `job-store.ts:141`)
- `dlp-scanner.ts` PHONE 패턴이 구분자 모두 optional(`?`)이라, job_id 안에 우연히 연속 숫자 8자리+ 런이 생기면 "전화번호"로 **오탐(false positive)**
- 즉 P2가 아닌 합성 식별자를 DLP가 차단 → 멀쩡한 PASS 인보이스의 다운로드를 간헐적으로 막음
- AMBER/ZERO 테스트가 통과한 이유: ZERO는 `verdict !== 'ZERO'` 조건으로 DLP 차단 면제, AMBER는 해당 run의 random job_id가 우연히 매칭 안 됨

**원래 worklog가 제안했던 수정(`EXPORTS_MAP.has(jobId)` 가드)은 채택하지 않음**: 프로덕션 fast-path(같은 인스턴스에서 export한 경우)의 DLP를 영구 비활성화하는 보안 구멍이며, 플래키성도 완전히 제거 못 함.

**실제 적용한 수정 (operator 결정 2026-06-14)**: `/api/export/download` 라우트에서 **워크북 DLP 재스캔을 완전히 제거**.
- `scanWorkbook` import, `buildSheetsFromExportRequest` 헬퍼, DLP_BLOCK 분기 삭제
- `exportReq` 빌드는 cross-instance 재생성 fallback용으로 유지
- `dlp-scanner.ts`의 `scanWorkbook`은 정의 유지(현재 미사용), `scanForDlpViolations`/`assertDlpClean`은 그대로
- `CLAUDE.md` Key Constraints의 "16 P2 categories in DLP export gate" 항목을 실제 상태로 갱신

> ⚠️ 트레이드오프: 최종 Excel은 이제 download 시점에 워크북 레벨 DLP 재스캔을 받지 않음. 계약 단가·TRN·BL번호 등 P2가 워크북에 들어있으면 그대로 노출됨. operator가 영향 인지 후 승인.

**검증**: `pnpm vitest run tests/api-export-download.test.ts` × 15회 → 15 pass / 0 fail (플래키 제거 확정)

### 3.2 검증 완료

| 검증 항목 | 상태 |
|----------|------|
| `pnpm --dir apps/web typecheck` | ✅ 0 errors |
| `pnpm --dir apps/web test` 전체 | ✅ 136 tests, 28 files |
| `pnpm --dir apps/mcp-server typecheck` | ✅ 0 errors |
| `pnpm --dir apps/mcp-server test` | ✅ 186 tests |
| `pytest -q` in apps/worker-py | ✅ 95 tests, 81% coverage |
| 전체 베이스라인 | ✅ 417 tests PASS (388/405 상회) |

---

## 4. 다음 실행 순서

1. 다음 두 파일 읽기 (병렬):
   - `apps/web/src/lib/export-store.ts`
   - `apps/web/src/app/api/audit/export/route.ts` (또는 `apps/web/src/app/api/export/route.ts`)
   
2. EXPORTS_MAP 동작 확인 후 `apps/web/src/app/api/export/download/route.ts` 수정 적용

3. `pnpm --dir apps/web test` 실행 → api-export-download.test.ts PASS 확인

4. 전체 검증:
   ```bash
   pnpm --dir apps/web typecheck && pnpm --dir apps/web test
   pnpm --dir apps/mcp-server typecheck && pnpm --dir apps/mcp-server test
   cd apps/worker-py && pytest -q
   ```

5. 405-test 베이스라인 확인 후 Phase 5 커밋

---

## 5. 변경 파일 목록

### 신규 생성
```
load-tests/k6/invoice-audit-smoke.js
load-tests/k6/invoice-audit-load.js
load-tests/k6/db-pool-pressure.js
load-tests/k6/mcp-route-smoke.js
load-tests/README.md
load-tests/results/.gitkeep
packages/telemetry/package.json
packages/telemetry/src/index.ts
packages/shared/trace-redact.ts
apps/web/src/instrumentation.ts
apps/web/src/lib/telemetry.ts
apps/web/tests/db-pool-pressure.test.ts
apps/mcp-server/src/telemetry.ts
apps/worker-py/app/telemetry.py
.github/workflows/reliability.yml
```

### 수정
```
apps/web/package.json             — @invoice-audit/telemetry, @opentelemetry/api 추가
apps/mcp-server/package.json      — @opentelemetry/api 추가
apps/mcp-server/src/main.ts       — initMcpTelemetry() 호출
apps/worker-py/app/main.py        — init_telemetry() 호출
apps/worker-py/pyproject.toml     — OTel 패키지 추가
packages/shared/package.json      — trace-redact.ts 진입점 추가
pnpm-lock.yaml                    — OTel 157개 패키지 (packages/telemetry, mcp-server)
```

### 미변경 (Phase 5 범위 외)
```
apps/web/src/lib/types.ts         — (git에서 modified로 표시, Phase 5와 무관한 선행 변경)
apps/web/src/lib/job-store.ts     — 동일
apps/web/src/lib/job-store-pg.ts  — 동일
```
