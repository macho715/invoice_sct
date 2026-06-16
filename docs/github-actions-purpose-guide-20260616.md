# GitHub Actions Purpose Guide

확인 기준: 2026-06-16, 현재 저장소 `SCT_ONTOLOGY-main`.

이 문서는 GitHub Actions 화면에 보이는 각 항목이 왜 실행되는지 설명한다.  
근거는 `.github/workflows/*.yml`과 `.github/dependabot.yml`의 실제 설정이다.

## 한 줄 결론

이 저장소의 Actions는 네 가지 목적을 가진다.

1. 코드가 빌드되고 테스트되는지 확인한다.
2. 인보이스 감사 플랫폼의 13-sheet workbook, worker, MCP, web 흐름을 릴리스 전에 막는다.
3. 시크릿, 취약점, CodeQL 같은 보안 위험을 잡는다.
4. `main`에 들어간 웹 앱을 Vercel production으로 배포한다.

## 화면에 보이는 항목과 실제 파일

| Actions 화면 이름 | 실제 파일 | 성격 | 주 목적 |
|---|---|---|---|
| CodeQL | `.github/workflows/codeql.yml` | 보안 분석 | JS/TS와 Python 코드 취약점 정적 분석 |
| Dependabot Updates | `.github/dependabot.yml` | 의존성 업데이트 | npm, pip, GitHub Actions 의존성 업데이트 PR 생성 |
| Python Worker CI | `.github/workflows/python-worker-ci.yml` | Python CI | `apps/worker-py` 파서/엑셀 worker 검증 |
| Release Gate (MVP SC-001..SC-013) | `.github/workflows/release-gate.yml` | 릴리스 차단 게이트 | workbook, worker, web, MCP, E2E를 묶어 릴리스 가능 여부 판단 |
| Reliability (optional) | `.github/workflows/reliability.yml` | 선택 검증 | k6 smoke와 DB pool 압력 테스트 |
| Secret Scan | `.github/workflows/secret-scan.yml` | 보안 스캔 | 토큰, 비밀키, 민감값 커밋 방지 |
| Vercel Production Deployment | `.github/workflows/vercel-prod.yml` | 배포 | `main` push 후 Vercel production 배포 |
| Web CI | `.github/workflows/web-ci.yml` | Web/TS CI | web, MCP, shared packages 빌드/타입/테스트/E2E 검증 |

## CodeQL

### 왜 하는가

CodeQL은 코드 안의 보안 취약점과 위험한 패턴을 찾는다.  
이 저장소는 TypeScript/JavaScript 웹 앱과 Python worker를 같이 쓰므로 두 언어를 모두 분석한다.

### 언제 실행되는가

`main` 브랜치 push, `main` 대상 PR, 매주 월요일 06:17 UTC 스케줄에서 실행된다.

### 무엇을 확인하는가

`javascript-typescript`와 `python` matrix를 돌린다.  
GitHub CodeQL init, autobuild, analyze 단계를 실행한다.

### 실패하면 무슨 뜻인가

보안 분석 중 취약점 또는 분석 실패가 발생했다는 뜻이다.  
릴리스 전에 해당 경고가 실제 위험인지 triage해야 한다.

## Dependabot Updates

### 왜 하는가

오래된 패키지와 GitHub Actions 버전을 주기적으로 올리기 위해 사용한다.  
보안 패치가 포함된 dependency update를 사람이 놓치지 않게 PR로 만든다.

### 언제 실행되는가

`.github/dependabot.yml` 기준으로 매주 실행된다.  
GitHub Actions workflow 파일은 아니지만 Actions 화면에는 Dependabot Updates로 보일 수 있다.

### 무엇을 확인하는가

아래 네 영역을 weekly로 확인한다.

| 생태계 | 대상 경로 | PR 제한 |
|---|---|---|
| npm | `/` | 최대 10개 |
| npm | `/apps/web` | 최대 10개 |
| pip | `/apps/worker-py` | 최대 10개 |
| github-actions | `/` | 최대 5개 |

### 실패하면 무슨 뜻인가

대개 업데이트 PR 생성 실패, package manifest 해석 실패, 권한 문제, registry 접근 문제를 뜻한다.  
앱 기능 실패라기보다 공급망 관리 실패에 가깝다.

## Python Worker CI

### 왜 하는가

`apps/worker-py`는 PDF/XLSX/Markdown/TXT 파싱, OCR 연동, workbook export의 핵심 worker다.  
이 worker가 깨지면 Rule #0의 최종 Excel 산출물 보장이 흔들린다.

### 언제 실행되는가

`main` push 때 실행된다.  
PR에서는 `apps/worker-py/**` 또는 `.github/workflows/python-worker-ci.yml`이 바뀔 때 실행된다.

### 무엇을 확인하는가

1. `uv sync --frozen`으로 Python 의존성을 잠금 파일 기준 설치한다.
2. `ruff check app/`를 실행한다. 현재는 `|| echo`가 붙어 있어 non-blocking이다.
3. `uvx pip-audit --strict`로 Python 의존성 취약점을 검사한다.
4. `uv run pytest`로 worker 테스트를 실행한다.

### 실패하면 무슨 뜻인가

worker 의존성, 취약점, parser/export 테스트 중 하나가 깨졌다는 뜻이다.  
특히 `pytest` 실패는 PDF/XLSX parsing 또는 workbook export 동작 회귀일 가능성이 있다.

## Release Gate (MVP SC-001..SC-013)

### 왜 하는가

개별 CI보다 더 강한 릴리스 승인용 묶음 게이트다.  
MVP success criteria를 네 그룹으로 모아 release-ready 여부를 판단한다.

### 언제 실행되는가

수동 실행, `v*` tag push, 또는 PR에 `release-gate` label이 붙었을 때 실행된다.

### 무엇을 확인하는가

| Job | 이유 | 핵심 확인 |
|---|---|---|
| `SC-DLP` | parent invoice workflow의 Track 1 체크와 연결하기 위한 placeholder | 현재 repo 안에서는 notice만 찍고 통과 |
| `SC-Python-CI` | worker와 workbook 계약 보호 | fixture 생성, 13-sheet 순서 검증, 금지 sheet 부재, pytest coverage 80%, import smoke, domestic pytest |
| `SC-TS-Checks` | web/MCP TypeScript 안정성 보호 | web typecheck/lint/test, invoice tests, MCP typecheck/test, MCP tool 파일 수 확인 |
| `SC-E2E` | 실제 브라우저 흐름 보호 | Playwright browser 설치 후 `pnpm test:e2e` 실행 |
| `Gate-Summary` | 전체 결과를 하나로 판단 | SC job 결과를 summary로 만들고 실패 시 gate 실패 |

### Playwright를 왜 하는가

TypeScript 테스트는 함수와 API 단위를 많이 본다.  
Playwright는 실제 브라우저에서 `/invoice-audit` 같은 화면과 업로드/다운로드 흐름이 사용자 기준으로 동작하는지 본다.

이 저장소에서 Playwright는 특히 다음 위험을 줄인다.

1. 업로드 UI가 렌더링되지 않는 문제.
2. API는 살아 있지만 브라우저 route나 버튼 흐름이 깨진 문제.
3. PASS/AMBER/ZERO 결과 화면과 workbook download 흐름이 깨진 문제.
4. 대용량 업로드 direct-upload 경로가 의도와 다르게 동작하는 문제.

### 주의점

`SC-DLP`라는 job 이름이 있지만 현재 repo의 active rule은 LP/DLP를 새 gate로 추가하지 말라는 쪽이다.  
현재 `release-gate.yml`의 `SC-DLP`는 실제 DLP scan을 이 repo에서 수행하지 않고 parent invoice workflow에 위임한다는 notice만 출력한다.

## Reliability (optional)

### 왜 하는가

정상 기능 테스트가 아니라 운영 안정성을 보기 위한 선택 검증이다.  
부하 또는 DB pool 압력처럼 일반 CI가 잘 잡지 못하는 문제를 보완한다.

### 언제 실행되는가

수동 실행 또는 PR에 `reliability` label이 붙었을 때 실행된다.

### 무엇을 확인하는가

`k6-smoke`는 k6를 설치하고 `load-tests/k6/invoice-audit-smoke.js`를 실행한다.  
`db-pool-tests`는 `apps/web`의 `tests/db-pool-pressure.test.ts`를 실행한다.

### 실패하면 무슨 뜻인가

`k6-smoke`는 `continue-on-error: true`라서 실패해도 PR을 막지 않는다.  
운영 성능 참고 자료로 보는 것이 맞다.

`db-pool-tests`는 DB connection pool 압력 조건을 확인한다.  
이 테스트 실패는 동시 요청이나 pool 설정에서 문제가 생길 수 있다는 신호다.

## Secret Scan

### 왜 하는가

이 저장소는 invoice, OCR, workbook, GCS, Vercel, database 관련 민감 설정을 다룬다.  
실제 토큰이나 private URL이 Git history에 들어가면 사고로 이어질 수 있다.

### 언제 실행되는가

모든 push와 pull_request에서 실행된다.

### 무엇을 확인하는가

Docker로 `zricethezav/gitleaks:latest`를 실행한다.  
`.gitleaks.toml` 설정을 사용하고 `--redact`로 민감값을 로그에 직접 노출하지 않는다.

### 실패하면 무슨 뜻인가

커밋 범위 또는 Git history 안에 secret 패턴이 감지됐다는 뜻이다.  
단순 문자열 오탐일 수 있지만, 실제 secret이면 즉시 폐기/회전이 필요하다.

## Vercel Production Deployment

### 왜 하는가

`apps/web`을 production Vercel 환경으로 배포한다.  
CI 검증과 별개로 실제 사용자에게 서비스되는 웹 앱 산출물을 만드는 workflow다.

### 언제 실행되는가

`main` 브랜치 push에서만 실행된다.  
job 자체도 `github.ref == 'refs/heads/main'` 조건을 한 번 더 확인한다.

### 무엇을 확인하는가

1. `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secret이 있는지 확인한다.
2. secret이 없으면 notice만 남기고 배포 단계를 건너뛴다.
3. secret이 있으면 Vercel CLI를 설치한다.
4. `vercel pull --environment=production`으로 production 환경 정보를 가져온다.
5. `vercel build --prod`로 production build를 만든다.
6. `vercel deploy --prebuilt --prod`로 production에 배포한다.
7. 배포 URL이 있으면 GitHub Deployment 기록을 만든다.

### 실패하면 무슨 뜻인가

Vercel secret, Vercel build, 또는 Vercel production deploy 중 하나가 실패했다는 뜻이다.  
코드 테스트 통과와 실제 production 배포 성공은 별개이므로 이 workflow가 따로 있다.

## Web CI

### 왜 하는가

이 저장소의 TypeScript/Next.js 쪽 변경을 가장 넓게 검증한다.  
`apps/web`, `apps/mcp-server`, `packages/contracts`, `packages/shared`, `packages/tools`, `packages/database`를 matrix로 확인한다.

### 언제 실행되는가

`main` 또는 `develop` 대상 PR에서 실행된다.  
`main` push에서도 실행된다.

### 무엇을 확인하는가

| Job | 이유 | 핵심 명령 |
|---|---|---|
| Root Install | workspace 의존성 잠금 검증 | `pnpm install --frozen-lockfile` |
| Checks | 각 TS package의 타입/테스트 검증 | `pnpm typecheck`, optional `pnpm lint`, optional `pnpm run test -- --run` |
| Build | Next.js production build 검증 | `pnpm --dir apps/web build` |
| Accessibility | 접근성 check placeholder 실행 | `pnpm --dir apps/web a11y` |
| E2E | 브라우저 smoke 검증 | `pnpm --dir apps/web exec playwright install --with-deps`, `pnpm --dir apps/web e2e` |

### Playwright job이 긴 이유

GitHub runner에는 브라우저와 OS-level browser dependency가 기본으로 모두 깔려 있지 않다.  
그래서 `Install Playwright Browsers` 단계에서 Chromium 등 브라우저와 Linux 의존성을 설치한다.

스크린샷에서 `apt` 패키지가 많이 보이는 이유는 이 설치 단계 때문이다.  
테스트가 느려 보이지만, 실제 사용자 브라우저 동작을 확인하려면 필요한 준비 단계다.

### 실패하면 무슨 뜻인가

`Checks` 실패는 타입, lint, unit test 문제다.  
`Build` 실패는 Next.js production build가 깨졌다는 뜻이다.  
`E2E` 실패는 브라우저에서 사용자 흐름이 깨졌다는 뜻이다.

## 어떤 Action을 먼저 봐야 하는가

PR에서 빨리 원인을 찾을 때는 아래 순서가 실용적이다.

1. `Secret Scan`: secret이면 즉시 해결해야 한다.
2. `Web CI / Checks`: 타입과 unit test 실패를 먼저 고친다.
3. `Python Worker CI`: worker 변경이 있으면 parser/export 테스트를 본다.
4. `Web CI / Build`: production build 문제를 본다.
5. `Web CI / E2E` 또는 `Release Gate / SC-E2E`: 실제 브라우저 흐름 문제를 본다.
6. `CodeQL`: 보안 finding인지 분석 실패인지 구분한다.
7. `Vercel Production Deployment`: `main` merge 이후 production 배포 문제를 본다.
8. `Reliability`: 선택 검증이므로 운영 리스크 참고 자료로 본다.

## 현재 문서화 기준의 확인 한계

이 문서는 로컬 저장소의 workflow 파일 기준이다.  
GitHub Actions의 최신 실행 결과, repository settings, branch protection required checks, secret 존재 여부는 현재 문서 작성 중 직접 조회하지 않았다.

따라서 이 문서는 “각 Action이 왜 존재하고 무엇을 검사하는가”에 대한 문서다.  
“현재 GitHub에서 어떤 check가 필수 required check인가”는 GitHub repository settings에서 별도로 확인해야 한다.
