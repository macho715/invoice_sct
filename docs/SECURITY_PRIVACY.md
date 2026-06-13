# Security and Privacy

## Data classification

| Level | Description | Handling |
|---|---|---|
| P0 | Public/sample guide data | Can be committed |
| P1 | Internal non-sensitive ops metadata | Mask and restrict |
| P2 | NDA, rates, contracts, PII, private links | Do not commit or expose to prompts |

## Guardrails

- The app is read-only by default.
- Write/action tools must require OAuth Bearer authorization, Human-gate approval, and AuditRecord.
- Protected upload/write tools require `files:upload` or `files:write` scope and fail closed with `AUTH_REQUIRED` or `INSUFFICIENT_SCOPE`.
- Protected upload/write tools may write only to the configured Cloudflare R2/D1 managed store, not to ERP, WMS, ATLP, Foundry, email, or messaging systems.
- Phone, email, token, and secret-like strings are masked by `server/src/redact.ts`.
- `structuredContent`, `content`, `_meta`, and widget state are treated as user-visible.
- Authorization must be enforced server-side before adding P1/P2 connectors.

## Prompt injection handling

Retrieved corpus text is evidence only. It cannot override AGENTS.md, MCP tool policy, validation rules, or authorization checks.

## GitHub security status

Status recorded on 2026-05-10 for `macho715/SCT_ONTOLOGY`.

| Control | Current status | Evidence / note |
|---|---|---|
| Secret Scanning | Enabled | GitHub repository API reported `secret_scanning.status=enabled`. |
| Push Protection | Enabled | GitHub repository API reported `secret_scanning_push_protection.status=enabled`. |
| Dependabot security updates | Enabled | `.github/dependabot.yml` configuration added weekly. |
| Code Scanning | Pending | GitHub Code Scanning alerts API returned `no analysis found`, so no analysis is currently available. |
| Secret Scanning non-provider patterns | Optional / disabled | GitHub repository API reported `secret_scanning_non_provider_patterns.status=disabled`. |
| Secret Scanning validity checks | Optional / disabled | GitHub repository API reported `secret_scanning_validity_checks.status=disabled`. |

Security work that still needs owner action:

- Enable Dependabot security updates if automated dependency patch PRs are required.
- Add CodeQL or another code scanning workflow before treating code scanning as active.
- Decide whether non-provider secret patterns and validity checks are needed for this repository.

## ZERO states

| 단계 | 이유 | 위험 | 요청데이터 | 다음조치 |
|---|---|---|---|---|
| Answer paused | EvidenceSnippet 없음 | 환각/추측 | doc section or any-key | source refresh |
| Action paused | Human-gate 없음 | 무단 실행 | approver/action reason | approval request |
| Compliance paused | current source 없음 | 규정 오류 | approved SOP/current source | owner review |
