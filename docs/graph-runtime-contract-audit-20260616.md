# Graph Runtime Contract Audit

확인 기준: 2026-06-16, 현재 로컬 저장소.

이 문서는 첨부 텍스트 중 graph 관련 내용만 반영한다.  
auth, worker 공개 접근, CI no-op, tool count 정리 같은 비그래프 작업은 이 패치에서 제외했다.

## 현재 Graphify 상태

현재 Graphify 산출물은 `apps` 폴더 기준이다.

| 항목 | 값 |
|---|---:|
| graph root | `apps` |
| graph json | `apps/graphify-out/graph.json` |
| graph html | `apps/graphify-out/graph.html` |
| nodes | 1499 |
| links | 2546 |
| communities | 142 |
| built_at_commit | `aadfa49bbcba65c48ea9851d359c8766afc5adaa` |

소스 파일 분포는 다음과 같다.

| 영역 | 고유 source_file 수 |
|---|---:|
| `web/` | 115 |
| `worker-py/` | 73 |
| `mcp-server/` | 39 |
| `markitdown-mcp/` | 2 |

따라서 현재 그래프는 `apps/web`, `apps/worker-py`, `apps/mcp-server`를 포함한다.  
다만 graph root가 `apps`이므로 `packages/*`, `migrations/*`, `.github/workflows/*`는 포함하지 않는다.

## 핵심 한계

Graphify 그래프는 정적 코드/심볼 그래프다.  
정적 import와 AST 관계는 잘 보이지만, 운영 중 HTTP/API로 이어지는 관계는 충분히 보이지 않는다.

이 저장소의 실제 런타임 흐름은 README 기준으로 다음 경로가 중요하다.

```text
Vercel web
  -> Vercel Blob / Neon
  -> worker /v1/parse
  -> web gate bridge
  -> worker /v1/export
  -> /api/export/download
```

이 흐름은 코드 import만으로는 완전히 표현되지 않는다.  
그래서 static graph만 보고 리팩터링하면 `web -> worker`, `web -> Blob`, `web -> Neon`, `web -> MCP validation` 같은 critical runtime edge를 놓칠 수 있다.

## 패치 내용

`architecture-contracts.json`을 추가했다.  
이 파일은 static graph가 놓치기 쉬운 runtime dependency edge를 별도 감사 대상으로 기록한다.

현재 기록한 edge는 다음과 같다.

| id | from | to | 의미 |
|---|---|---|---|
| `web-run-to-worker-parse` | `POST /api/invoice-audit/run` | worker `POST /v1/parse` | invoice source parsing |
| `web-export-to-worker-export` | `POST /api/audit/export` | worker `POST /v1/export` | 13-sheet workbook export |
| `web-download-to-worker-export-fallback` | `GET /api/export/download` | worker `POST /v1/export` | download fallback export |
| `web-to-vercel-blob` | web upload/download routes | Vercel Blob | source/evidence/workbook object storage |
| `web-to-neon-job-store` | web job-store | Neon Postgres | job/result/trace persistence |
| `web-to-mcp-validation` | web validation runner | MCP validation tools | validation findings for gate bridge |

## 사용 규칙

1. Graphify HTML은 코드 구조 탐색용으로 본다.
2. `architecture-contracts.json`은 운영 edge 감사용으로 본다.
3. 두 파일이 충돌하면 실제 runtime route와 README 운영 흐름을 우선 확인한다.
4. repo 전체 SSOT를 보려면 `apps`가 아니라 repository root 기준 Graphify를 별도로 생성해야 한다.

## CI 검증

`scripts/verify-architecture-contracts.mjs`를 추가했다.  
이 스크립트는 `architecture-contracts.json`의 6개 edge가 실제 파일, endpoint 문자열, contract 심볼에 연결되는지 확인한다.

```bash
pnpm verify:architecture-contracts
```

`Web CI`의 `Root Install` job에도 같은 명령을 연결했다.  
따라서 PR에서 runtime edge 정의가 실제 코드와 어긋나면 CI가 실패한다.
