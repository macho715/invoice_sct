# Plan — D2: Supply-Chain Hardening (uv.lock + SCA)

**Plan ID**: D2-2026-06-11
**Parent**: SWARM-2026-06-10-deep-5-execution-plan §D2
**Owner**: backend
**Status**: ✅ 4/5 tasks complete (T1~T4), T5 optional pending
**Last verified**: 2026-06-11

---

## 1. Overview

apps/worker-py (Python FastAPI invoice audit worker) 의 의존성 lockfile 부재와 software composition analysis (SCA) 부재를 해소하여 PII invoice 처리 환경의 supply-chain risk 를 줄이고, reproducible build 와 자동 보안 감시를 가능하게 한다.

---

## 2. Goals

- **G1**: apps/worker-py 의 모든 transitive dependencies 가 lockfile 로 고정되어 어느 환경에서든 동일 버전 설치 보장
- **G2**: `verify` 명령 한 번으로 SCA + lint + test + dry-run + typecheck 가 모두 통과
- **G3**: Dependabot 이 보안 업데이트 PR 을 자동 생성
- **G4**: PII/P0 데이터 처리 경로의 정적 보안 분석 (선택)

---

## 3. Scope

### In Scope
- `apps/worker-py/uv.lock` 생성 및 커밋
- `apps/worker-py/pyproject.toml` 의 open range dependency 를 narrow range 로 변환 (이미 완료: `~=` 적용)
- `package.json` `verify` script 에 `pip-audit --strict` 추가 (이미 완료: line 34)
- `.github/dependabot.yml` 작성 (이미 존재)
- (선택) `bandit` 정적 분석 추가

### Out of Scope
- 다른 Python 프로젝트 (D1 의 D1 swap 자체, scripts/ 디렉토리 등)
- TypeScript/Node 의 SCA 강화 (D3 vitest v3 align 의 일부로 별도)
- Cloudflare Worker (`server/`) 의 lockfile (D3 에서 다루지 않음)
- Python worker 의 Dockerfile / 배포 환경 변경

---

## 4. Constraints

- apps/worker-py 의 pytest 36/36 회귀 없이 진행
- pyproject.toml 의 `requires-python = ">=3.11"` 유지
- 기존 `~=` narrow pin 정책 유지 (재 open range 화 금지)
- uv 환경 사용 (pip-tools / poetry 전환 금지)

---

## 5. Phases

### Phase 1. lockfile 생성 (완료)
- uv lockfile 생성 + 커밋

### Phase 2. SCA 통합 (완료)
- pip-audit --strict → verify script 통합
- Dependabot 활성화

### Phase 3. (선택) 정적 분석
- bandit 통합 — 보안 priority medium/low 만 존재 시 skip 가능

---

## 6. Tasks

| ID | Task | Status | Evidence |
|---|---|---|---|
| **D2-T1** | `uv lock` → `uv.lock` 생성 + 커밋 | ✅ Done | `apps/worker-py/uv.lock` 존재 |
| **D2-T2** | `pyproject.toml` open range → `~=` | ✅ Done | `pyproject.toml:7-12` 모두 `~=` |
| **D2-T3** | `verify` script 에 `pip-audit --strict` 추가 | ✅ Done | `package.json:34` `(cd apps/worker-py && uvx pip-audit --strict)` |
| **D2-T4** | Dependabot 활성화 (security updates) | ✅ Done | `.github/dependabot.yml` 존재 |
| **D2-T5** | (선택) `bandit -r apps/worker-py/app/` 추가 | ⏳ Pending | `bandit` 미설치, 정적 분석 보류 |

---

## 7. Risks

- **R1 (Low)**: lockfile 생성 시 transitive deps 충돌 → Phase 1/2/3 pytest 통과로 검증
- **R2 (Low)**: pip-audit false positive → `--strict` exit 0 으로 확인
- **R3 (Medium)**: Dependabot PR 노이즈 → `weekly` interval + `groups` 로 묶음 처리
- **R4 (Low)**: bandit High/Medium 발견 시 코드 수정 필요 → PII 처리 경로 우선 점검

---

## 8. Review Criteria

- [x] `uv.lock` 커밋됨 (해시 chain 검증)
- [x] `pip-audit --strict` exit 0
- [x] `verify` 명령 한 번에 typecheck + vitest + dry-run + pip-audit 통과 (vitest 392/392, pytest 36/36)
- [x] Dependabot config 검증: `npm`, `pip`, `github-actions` ecosystem 모두 포함
- [ ] (선택) `bandit -r apps/worker-py/app/` High 0

---

## 9. Deliverables

| Deliverable | Path | Status |
|---|---|---|
| uv lockfile | `apps/worker-py/uv.lock` | ✅ |
| pyproject.toml narrow pins | `apps/worker-py/pyproject.toml:6-13` | ✅ |
| verify script | `package.json:34` | ✅ |
| Dependabot config | `.github/dependabot.yml` | ✅ |
| (선택) bandit config | — | ⏳ |

---

## Assumptions

- Assumption: `uv` 가 사용자 환경에 설치되어 있다 (Cloudflare CI 에서 `uvx` 사용 가능)
- Assumption: pip-audit 의 false positive 가 0건 (현재 exit 0)
- Assumption: Dependabot GitHub Actions 권한이 organization level 에서 활성화되어 있다

---

## References

- SWARM Deep-5 plan: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` §D2
- pyproject.toml: `apps/worker-py/pyproject.toml`
- verify script: `package.json:7-39` (lines 7-39)
- pip-audit 통합: `package.json:34`
- Dependabot config: `.github/dependabot.yml`
- 검증 결과: vitest 392/392 + pytest 36/36 (2026-06-11 실행)
