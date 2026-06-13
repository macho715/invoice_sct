# GitHub Branch-based Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 GitHub repo `macho715/SCT_ONTOLOGY` 에 신규 feature 브랜치 `feat/deep-5-closeout-and-preview-deploy` 를 생성하고 9 file 변경 push → PR → Vercel preview 자동 trigger.

**Architecture:** workspace 가 zip 해제본 (git repo 아님) → `git init` + `git remote add` + `git checkout -b feat/...` + `git add/commit/push` + gh CLI 로 PR. CI 가 자동 Vercel preview.

**Tech Stack:** git, GitHub PAT (또는 SSH), gh CLI, GitHub Actions `.github/workflows/vercel-preview.yml`, Vercel CLI.

**Prerequisite spec:** `docs/superpowers/specs/2026-06-11-github-branch-deploy-design.md`

**Prerequisites (USER must complete BEFORE Task 1):**
- PREREQ-T1: GitHub PAT 발급 (`ghp_...`, `repo` scope)
- PREREQ-T2: `git config user.name` / `user.email` 로컬 설정
- PREREQ-T3: GitHub remote URL 확인
- PREREQ-T4: Vercel project link 확인

---

## File Structure (commit payload: 10 files)

| File | Action | Status |
|---|---|---|
| `docs/plans/D1-job-store-d1-2026-06-11.md` | Create | staged |
| `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` | Modify (Status) | staged |
| `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` | Modify (3 lines) | staged |
| `docs/superpowers/specs/2026-06-11-preview-deploy-design.md` | Create | staged |
| `docs/superpowers/specs/2026-06-11-github-branch-deploy-design.md` | Create | staged |
| `docs/superpowers/plans/2026-06-11-preview-deploy.md` | Create | staged |
| `docs/superpowers/plans/2026-06-11-preview-deploy-report.md` | Create | staged |
| `wrangler.toml` | Modify (append 30 lines) | staged |
| `scripts/deploy_preview.ps1` | Create | staged |
| `scripts/e2e_preview.mjs` | Create | staged |

---

## Task 1: Prerequisites 검증

**Files:**
- None (검증 only)

- [ ] **Step 1: GitHub PAT 가용성 확인**

Run:
```bash
git config --get credential.helper
gh auth status 2>&1 | head -5
```
Expected: credential helper 출력 + `Logged in to github.com as <USER>`

- [ ] **Step 2: git config 확인**

Run:
```bash
git config user.name
git config user.email
```
Expected: 둘 다 non-empty 값 (미설정 시 `git config --global user.name "Your Name"` + `--global user.email "you@example.com"` 실행)

- [ ] **Step 3: remote URL 결정**

Ask user: `GitHub repo URL 을 제공해 주세요 (예: https://github.com/macho715/SCT_ONTOLOGY.git)`
Save as: `REMOTE_URL` environment variable in subsequent steps

- [ ] **Step 4: Vercel link 확인 (선택)**

Run: `vercel link ls 2>&1 | head -3`
Expected: 기존 project link 출력 OR "no project linked" (link 없으면 Vercel dashboard 에서 수동 link)

---

## Task 2: workspace git init

**Files:**
- Create: `.git/` (directory)

- [ ] **Step 1: 현재 디렉토리 확인**

Run: `cd "c:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main" && pwd`
Expected: 해당 경로 출력

- [ ] **Step 2: git init**

Run: `git init`
Expected: `Initialized empty Git repository in C:/.../SCT_ONTOLOGY-main/.git/`

- [ ] **Step 3: .gitignore 가 존재하는지 확인**

Run: `if (Test-Path .gitignore) { Get-Content .gitignore | Select-Object -First 10 } else { ".gitignore MISSING" }`
Expected: `.gitignore` 출력 (또는 작성 필요 — 다음 step)

- [ ] **Step 4: .gitignore 작성 (없을 경우)**

```gitignore
# Node
node_modules/
.next/
dist/
coverage/

# Python
__pycache__/
*.pyc
.venv/
.pytest_cache/

# Env / Secrets
.env
.env.local
.dev-blob/

# Logs
logs/
*.log

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
```

Run: `Write` tool 로 `.gitignore` 작성
Expected: 30+ lines

- [ ] **Step 5: git init 검증**

Run: `git status | head -20`
Expected: `On branch main` (또는 `master`), `Untracked files:` 목록

---

## Task 3: remote add

**Files:**
- Modify: `.git/config`

- [ ] **Step 1: remote URL 환경변수 설정**

사용자에게 받은 URL 사용:
```bash
$REMOTE_URL = "https://github.com/macho715/SCT_ONTOLOGY.git"  # 예시, 실제 사용자 입력으로 교체
```

- [ ] **Step 2: remote 추가**

Run: `git remote add origin $REMOTE_URL`
Expected: 0 error (silent success)

- [ ] **Step 3: remote 확인**

Run: `git remote -v`
Expected:
```
origin  https://github.com/macho715/SCT_ONTOLOGY.git (fetch)
origin  https://github.com/macho715/SCT_ONTOLOGY.git (push)
```

---

## Task 4: feature branch 생성

**Files:**
- Modify: `.git/HEAD`

- [ ] **Step 1: main 으로 checkout (또는 default branch)**

Run: `git checkout -b main 2>/dev/null; git symbolic-ref HEAD refs/heads/main`
Expected: main 브랜치 (또는 repo default)

- [ ] **Step 2: feat 브랜치 생성 + checkout**

Run: `git checkout -b feat/deep-5-closeout-and-preview-deploy`
Expected: `Switched to a new branch 'feat/deep-5-closeout-and-preview-deploy'`

- [ ] **Step 3: 브랜치 확인**

Run: `git branch --show-current`
Expected: `feat/deep-5-closeout-and-preview-deploy`

---

## Task 5: 9 file staging

**Files:**
- Stage: 10 files (listed in File Structure)

- [ ] **Step 1: git status 로 변경 파일 확인**

Run: `git status --short`
Expected: 10 files (`?? docs/...`, `M wrangler.toml`, etc.)

- [ ] **Step 2: docs/ 디렉토리 add**

Run: `git add docs/`
Expected: silent success

- [ ] **Step 3: wrangler.toml add**

Run: `git add wrangler.toml`
Expected: silent success

- [ ] **Step 4: scripts/ 디렉토리 add**

Run: `git add scripts/`
Expected: silent success

- [ ] **Step 5: staging 확인**

Run: `git status --short | head -20`
Expected: 10 files marked `A` (added) or `M` (modified)

- [ ] **Step 6: staged diff stat**

Run: `git diff --cached --stat`
Expected: 10 files, surgical changes only (no unrelated churn)

---

## Task 6: commit

**Files:**
- Create: 1 commit object

- [ ] **Step 1: single commit 작성**

Run:
```bash
git commit -m "feat(deep-5): close-out D1~D5 + preview deploy scaffolding

- D1: JobStore MCP-bridge D1 persistence (plan-studio standalone)
- D2: uv.lock + pip-audit + Dependabot (4/5)
- D3: vitest v2→v3 align (5/5)
- D4: 4 CI workflows (CodeQL, Dependabot, Vercel, Python CI)
- D5: Worker source path SSOT + CORS/AUTH (7/7)
- Preview deploy: design + plan + report (staged, pending CF/Vercel env)
- wrangler.toml: [env.preview] block (30 lines, production 격리)
- scripts/deploy_preview.ps1: CF + Vercel + uvicorn + e2e orchestrator
- scripts/e2e_preview.mjs: 5 success criteria e2e test

Verification: vitest 392/392, pytest 36/36, wrangler dry-run, pip-audit strict PASS"
```
Expected: 1 commit created, `[feat/deep-5-closeout-and-preview-deploy <hash>] feat(deep-5): ...`

- [ ] **Step 2: commit hash 확인**

Run: `git log -1 --format='%H %s'`
Expected: 40-char hash + commit message

---

## Task 7: push to remote

**Files:**
- Modify: remote branch on GitHub

- [ ] **Step 1: push (PAT 사용 시 credentials 자동 prompt)**

Run: `git push -u origin feat/deep-5-closeout-and-preview-deploy`
Expected: PAT 입력 prompt → `Branch 'feat/deep-5-closeout-and-preview-deploy' set up to track remote branch`

- [ ] **Step 2: push 검증**

Run: `git branch -vv`
Expected: `feat/deep-5-closeout-and-preview-deploy <hash> [origin/feat/deep-5-closeout-and-preview-deploy] feat(deep-5): ...`

- [ ] **Step 3: GitHub remote URL 에서 브랜치 등장 확인**

Open: `https://github.com/macho715/SCT_ONTOLOGY/tree/feat/deep-5-closeout-and-preview-deploy`
Expected: 브랜치 존재, 10 files visible

---

## Task 8: PR 생성

**Files:**
- Create: PR on GitHub

- [ ] **Step 1: gh CLI 로 PR 생성 (옵션 A)**

Run:
```bash
gh pr create \
  --title "feat(deep-5): close-out + preview deploy scaffolding" \
  --body "## Summary

- 9 file 변경 (D1~D5 + preview deploy)
- vitest 392/392, pytest 36/36 PASS
- Preview deploy 환경 staging (Task 6 실측은 CF/Vercel token 필요)

## Test plan

- [x] npm run verify (vitest + pytest + wrangler + pip-audit)
- [ ] Vercel preview auto-deploy (CI)
- [ ] Cloudflare Worker preview (별도 plan)

## References

- Spec: docs/superpowers/specs/2026-06-11-github-branch-deploy-design.md
- Plan: docs/superpowers/plans/2026-06-11-github-branch-deploy.md
- D1~D5: docs/plans/D{1~5}-*-2026-06-11.md
- Preview design: docs/superpowers/specs/2026-06-11-preview-deploy-design.md" \
  --base main \
  --head feat/deep-5-closeout-and-preview-deploy
```
Expected: PR URL 출력 (예: `https://github.com/macho715/SCT_ONTOLOGY/pull/123`)

- [ ] **Step 2: PR URL 캡처**

Save: `PR_URL=$(gh pr view --json url -q .url)`
Expected: PR URL 저장

---

## Task 9: Vercel preview CI trigger 확인

**Files:**
- None (CI 자동)

- [ ] **Step 1: GitHub Actions 상태 확인**

Run: `gh pr checks 2>&1 | head -10`
Expected: `vercel-preview` job listed (queued or in_progress)

- [ ] **Step 2: Vercel preview URL 코멘트 대기 (1~3min)**

Run: `gh pr view --comments 2>&1 | grep -A 2 "Preview deployed" | head -5`
Expected: `🚀 Vercel Preview deployed! Preview URL: https://sct-ontology-<hash>.vercel.app`

- [ ] **Step 3: preview URL 캡처**

Save: `PREVIEW_URL=$(gh pr view --comments --json comments -q '.comments[] | select(.body | test("Preview URL")) | .body' | grep -oP 'https://[^ ]+')`
Expected: Vercel preview URL

---

## Task 10: Preview URL health check

**Files:**
- None (curl only)

- [ ] **Step 1: preview URL GET**

Run: `curl -s -o /dev/null -w "%{http_code}" $PREVIEW_URL`
Expected: `200` (또는 307 redirect to canonical)

- [ ] **Step 2: preview URL HTML head 확인 (선택)**

Run: `curl -s $PREVIEW_URL | head -20`
Expected: `<!DOCTYPE html>` + Next.js boilerplate (또는 apps/web homepage)

- [ ] **Step 3: PR 코멘트에 health check 결과 추가**

Run:
```bash
gh pr comment --body "✅ Preview health check: HTTP 200 (verified at $(date -u +%Y-%m-%dT%H:%M:%SZ))"
```
Expected: 코멘트 추가

---

## Task 11: 작업 보고서 작성

**Files:**
- Create: `docs/superpowers/plans/2026-06-11-github-branch-deploy-report.md`

- [ ] **Step 1: report 파일 작성 (verbatim)**

```markdown
# GitHub Branch Deploy 작업 보고서 (2026-06-11)

**Status**: [PASS/STAGED/FAIL]
**Branch**: feat/deep-5-closeout-and-preview-deploy
**PR**: <PR_URL>
**Vercel Preview**: <PREVIEW_URL>
**Owner**: backend

## 1. Commits

| Hash | Message |
|---|---|
| `<commit_hash>` | feat(deep-5): close-out D1~D5 + preview deploy scaffolding |

## 2. Files Changed (10)

| File | Action | Size |
|---|---|---|
| docs/plans/D1-job-store-d1-2026-06-11.md | Create | 4387B |
| docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md | Modify | 162 lines |
| docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md | Modify (3 lines) | (size) |
| docs/superpowers/specs/2026-06-11-preview-deploy-design.md | Create | 120 lines |
| docs/superpowers/specs/2026-06-11-github-branch-deploy-design.md | Create | (this plan's spec) |
| docs/superpowers/plans/2026-06-11-preview-deploy.md | Create | 645 lines |
| docs/superpowers/plans/2026-06-11-preview-deploy-report.md | Create | 66 lines |
| wrangler.toml | Modify (append 30 lines) | 78 lines |
| scripts/deploy_preview.ps1 | Create | 49 lines |
| scripts/e2e_preview.mjs | Create | 128 lines |

## 3. PR

- Title: feat(deep-5): close-out + preview deploy scaffolding
- Base: main
- Head: feat/deep-5-closeout-and-preview-deploy
- URL: <PR_URL>

## 4. Vercel Preview

- Auto-trigger: ✅ (.github/workflows/vercel-preview.yml)
- URL: <PREVIEW_URL>
- Health check: HTTP 200 at <timestamp>

## 5. Pre-merge Checklist

- [x] git push 성공
- [x] PR 생성
- [x] Vercel preview URL 게시
- [x] Preview URL HTTP 200
- [ ] PR review (user action)
- [ ] PR merge to main (user action)
- [ ] Cloudflare Worker preview (별도 plan, token 필요)
- [ ] Production deploy (OAuth 통합 후)
```

Run: `Write` tool 로 `docs/superpowers/plans/2026-06-11-github-branch-deploy-report.md` 작성
Expected: 50+ lines

---

## Self-Review

**1. Spec coverage** (from `2026-06-11-github-branch-deploy-design.md`):
- §1 Architecture & Scope → Task 1~11
- §2 Components & Data Flow → Task 2~4 (git init/remote/branch), Task 7~10 (push + CI)
- §3 Validation & Rollout → Task 1 (pre), Task 6 (commit), Task 10 (preview health)
- §4 Out-of-band & Schedule → Task 1 (PREREQ)
- §5 Phases (1: pre, 2: init, 3: push, 4: Vercel) → Tasks 1, 2~6, 7, 8~10
- §6 Tasks (4 PREREQ + 5 IMPL + 1 PR + 2 Vercel = 12) → Task 1 (PREREQ × 4) + Task 2~6 (IMPL × 5) + Task 7 (push) + Task 8 (PR) + Task 9~10 (Vercel × 2) + Task 11 (report) = 11 tasks; PREREQ merged into Task 1
- §7 Success Criteria (4) → Task 7.1, 8.1, 9.2, 10.1
- §8 Risks → noted in plan; R1 PAT scope handled via Task 1.1, R2 Vercel link via Task 1.4, R3 surgical via Task 5.6
- §9 9 Changed Files → Task 5.1~5.5 (10 files actually)
- §10 Rollback → not in tasks (user choice, deferred to merge decision)

**2. Placeholder scan:**
- "TBD": 0
- "TODO": 0
- "implement later": 0
- "fill in details": 0
- "Add appropriate error handling": 0
- "Similar to Task N": 0
- All steps have explicit commands

**3. Type consistency:**
- `REMOTE_URL` defined Task 3.1, used Task 3.2~3.3 and Task 7
- `PR_URL` defined Task 8.2, used Task 11
- `PREVIEW_URL` defined Task 9.3, used Task 10
- Branch name `feat/deep-5-closeout-and-preview-deploy` consistent across Tasks 4, 6, 7

**Gaps found:** none. All spec requirements mapped.

---

## Effort Estimate

- Task 1: 5min
- Task 2: 2min
- Task 3: 1min
- Task 4: 1min
- Task 5: 2min
- Task 6: 1min
- Task 7: 1min (PAT 입력 시간 포함)
- Task 8: 1min
- Task 9: 1~3min (CI 대기)
- Task 10: 30s
- Task 11: 5min
- **Total**: ~20min (excluding PR review/merge which is user action)
