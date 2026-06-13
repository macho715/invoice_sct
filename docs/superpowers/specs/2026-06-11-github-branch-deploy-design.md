# Design — GitHub Branch-based Deploy (2026-06-11)

**Status**: Design approved (4/4 sections) — ready for implementation via writing-plans
**Owner**: backend
**Target**: 15~20min after prerequisites met

---

## 1. Overview

기존 GitHub repo `macho715/SCT_ONTOLOGY` 에 신규 feature 브랜치 `feat/deep-5-closeout-and-preview-deploy` 를 생성하고, Deep-5 (D1~D5) close-out 산출물 9 file + preview deploy scaffolding 을 push. Vercel preview 환경 자동 검증 후 main 으로 PR merge.

## 2. Goals

- **G1**: 기존 GitHub repo 의 main 보호 (production 안정성)
- **G2**: PR review 단계 강제 (Vercel preview URL 자동 검증)
- **G3**: rollback 단순화 (브랜치 삭제만)
- **G4**: 9 file 변경의 단일 PR
- **G5**: Vercel preview 자동 trigger (`.github/workflows/vercel-preview.yml` 활용)

## 3. Scope

### In Scope
- `git init` (workspace git repo 부재 해소)
- `git remote add origin <USER-PROVIDED-URL>`
- `git checkout -b feat/deep-5-closeout-and-preview-deploy`
- 9 file commit (1 commit 또는 9 atomic)
- `git push -u origin feat/...`
- PR 생성 (gh CLI 또는 web)
- Vercel preview auto-trigger (.github/workflows/vercel-preview.yml)
- (선택) PR merge → main

### Out of Scope
- Cloudflare Worker preview deploy (별도 plan, OAuth + secrets 필요)
- Production deploy (OAuth integration 미완)
- Vercel project 신규 생성 (기존 가정)
- Main branch 직접 push (사용자 B 옵션으로 회피)

## 4. Constraints

- workspace 가 git repo 아님 확인 (이전 turn)
- GitHub PAT (또는 SSH) 사용자 환경에 설정 필요
- Vercel project 가 GitHub repo 와 link 되어 있어야 preview 자동
- 9 file 변경은 surgical (D1~D5 + preview scaffolding, unrelated churn 없음)
- PR title/body 는 conventional commits 형식

## 5. Phases

### Phase 1. Prerequisites (사용자, 5~10min)
- GitHub PAT 발급
- git config user 설정
- remote URL 확인
- Vercel project link 확인

### Phase 2. Local git init + commit (lead, 5min)
- `git init` → remote add → checkout -b → add → commit

### Phase 3. Push + PR (lead, 1min)
- `git push -u origin feat/...` → PR 생성

### Phase 4. Vercel preview auto (CI, 1~3min)
- vercel-preview.yml trigger → PR 코멘트에 URL 게시

## 6. Tasks

| ID | Task | Phase | Owner | Status |
|---|---|---|---|---|
| **PREREQ-T1** | GitHub PAT 발급 | 1 | user | ⏳ |
| **PREREQ-T2** | git config user.name/email | 1 | user | ⏳ |
| **PREREQ-T3** | remote URL 확인 | 1 | user | ⏳ |
| **PREREQ-T4** | Vercel project link 확인 | 1 | user | ⏳ |
| **IMPL-T1** | `git init` + `git remote add` | 2 | lead | ⏳ |
| **IMPL-T2** | `git checkout -b feat/...` | 2 | lead | ⏳ |
| **IMPL-T3** | `git add docs/ wrangler.toml scripts/` | 2 | lead | ⏳ |
| **IMPL-T4** | `git commit -m "..."` | 2 | lead | ⏳ |
| **IMPL-T5** | `git push -u origin feat/...` | 2 | lead | ⏳ |
| **PR-T1** | `gh pr create` | 3 | lead | ⏳ |
| **Vercel-T1** | vercel-preview.yml trigger | 4 | CI | ⏳ |
| **Vercel-T2** | PR 코멘트 게시 | 4 | CI | ⏳ |

## 7. Success Criteria (4)

1. `git push` exit 0, remote URL 에 브랜치 등장
2. PR 자동 생성 (또는 수동)
3. Vercel preview URL PR 코멘트에 게시
4. Preview URL `curl` → 200 OK

## 8. Risks

- **R1 (Medium)**: GitHub PAT scope 부족 (SSO org 일 경우 추가 approval)
- **R2 (Low)**: Vercel project 미생성 시 link 실패
- **R3 (Low)**: 9 file commit 의 unrelated churn 가능성
- **R4 (Low)**: 기존 `cloudflare_worker/worker.js` 잔존 참조가 SWARM plan 에 의도적 보존 — push 시 그대로 포함됨

## 9. 9 Changed Files (commit payload)

| File | Action | Size |
|---|---|---|
| `docs/plans/D1-job-store-d1-2026-06-11.md` | Create | 4387B |
| `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` | Modify (Status) | 162 lines |
| `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` | Modify (3 lines) | 200+ lines |
| `docs/superpowers/specs/2026-06-11-preview-deploy-design.md` | Create | 120 lines |
| `docs/superpowers/specs/2026-06-11-github-branch-deploy-design.md` | Create | (this file) |
| `docs/superpowers/plans/2026-06-11-preview-deploy.md` | Create | 645 lines |
| `docs/superpowers/plans/2026-06-11-preview-deploy-report.md` | Create | 66 lines |
| `wrangler.toml` | Modify (append 30 lines) | 78 lines |
| `scripts/deploy_preview.ps1` | Create | 49 lines |
| `scripts/e2e_preview.mjs` | Create | 128 lines |

## 10. Rollback

- `git push origin --delete feat/deep-5-closeout-and-preview-deploy` (remote)
- `git branch -D feat/deep-5-closeout-and-preview-deploy` (local)
- PR close 만 (merge 안 됐으면 main 무영향)
- Vercel preview URL 자동 만료

## Assumptions

- Assumption: GitHub PAT (`ghp_...`, `repo` scope) 가 로컬 환경에 설정되어 있다
- Assumption: `git config user.name` / `user.email` 가 로컬에 설정되어 있다
- Assumption: remote URL = `https://github.com/macho715/SCT_ONTOLOGY.git` (가정, 사용자 확인 필요)
- Assumption: Vercel project 가 GitHub repo 와 link 되어 있다 (또는 신규 link 가능)
- Assumption: workspace 가 git repo 아님 → `git init` 필요
- Assumption: 9 file 변경이 unrelated churn 없음 (surgical)

## References

- D1~D5 plans: `docs/plans/D{1~5}-*-2026-06-11.md`
- Preview deploy design: `docs/superpowers/specs/2026-06-11-preview-deploy-design.md`
- Vercel workflow: `.github/workflows/vercel-preview.yml`
- SWARM plan: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md`
- Existing D1~D5 close-out report: `docs/superpowers/plans/2026-06-11-preview-deploy-report.md`
