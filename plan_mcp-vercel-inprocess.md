# Plan: MCP 검증 서버를 Vercel(web) in-process로 통합

> 작성일: 2026-06-14 · 승인: 사용자 "1단계(MCP Vercel 통합) 먼저" 선택
> 목표: 인보이스 검증을 web 단독으로 완결 → Fly MCP·외부 HTTP·`MCP_UNAVAILABLE`·`CF_MCP_BASE_URL` 제거

## 배경/제약 (확인됨)

- monorepo workspace 없음(`pnpm-workspace.yaml`/루트 pkg 부재). Vercel은 `apps/web`만 빌드(`apps/web/vercel.json`) → **web은 `apps/mcp-server`를 import 불가**.
- 따라서 검증 흐름이 호출하는 6개 도구를 **web 안으로 포팅**하고 **HTTP 없이 in-process 호출**.
- in-process는 strict zod 입력이 적용됨 → **원인3(입력 스키마 불일치)을 함께 정렬**해야 실검증 동작.
- web tsconfig: `moduleResolution: bundler`, `@/* → ./src/*`. pg·zod 이미 deps.
- DLP 가드: in-process(외부/LLM 노출 아님)라 dispatcher에서 생략.

## 변경 파일

| 파일 | 작업 | 내용 |
|------|------|------|
| `apps/web/src/lib/mcp/db.ts` | 신규(포팅) | lazy pg Pool (DATABASE_URL). 없으면 throw→rate_card가 catch→AMBER |
| `apps/web/src/lib/mcp/tools.ts` | 신규(포팅) | 6개 도구(zod schema+run): route_question, classify_type_b, check_cost_guard, check_evidence_required, check_hs_uae_compliance, check_rate_card + `dispatch(name,args)` (zod parse→run) |
| `apps/web/src/lib/cf-mcp-client.ts` | 수정 | `callTool`(fetch+retry)→ in-process `dispatch` 래퍼. `validate()` 입력 shape 정렬(원인3): classify per-line, evidence `{line_id,charge_code,sct_code,present_evidence}`, hs_uae `{line_id,charge_code,hs_code,evidence_docs}`. costguard 입력 동일·`normCostguard` 유지. batch classify 제거 |
| `apps/web/src/app/api/invoice-audit/run/route.ts` | 소수정 | `createCfMcpClient` 호출에서 `CF_MCP_BASE_URL` 의존 제거 |
| `apps/web/tests/cf-mcp-client.test.ts` | 재작성 | fetch mock 제거 → 실제 포팅 도구 대상 in-process 테스트(결정론적, DB 불요: rate_card는 DATABASE_URL 미설정 시 AMBER) |

## 출력 계약(불변)

`validate()` 반환 구조(costguard_results/doc_guardian_results/hs_uae_results/gate_results 등)는 그대로 유지 → `run/route.ts`·`gate-bridge`·다른 테스트 무영향.

## 검증

- `pnpm typecheck` 0 errors
- `pnpm test` (재작성 cf-mcp-client + 회귀 전체)
- `next build` 성공
- in-process validate 더미 1라인 → costguard PASS

## 범위 외 (후속)

- 2단계: worker에 OpenDataLoader(JDK11+) 연결 → PDF→invoice_lines 매핑 → PDF 인보이스 검증
- 도구 코드 중복(web vs mcp-server) → 추후 `packages/` 공유화
- `apps/mcp-server`는 ChatGPT 앱용 보존(삭제 안 함)
