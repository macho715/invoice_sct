판정: **예 — 아래는 `Decision Card v2`를 실제 설계·개발·검증에 바로 쓰는 방법 문서입니다.**
근거: 첨부안의 핵심 요구는 `BLOCK Reason → Unblock Inputs → Evidence Trace → Action Owner` 중심 재설계이며, 카드 v2는 “설명 카드”가 아니라 “운영 의사결정 카드”로 전환해야 합니다. 
다음행동: 아래 문서를 `docs/guidelines/decision-card-v2-method.md`로 저장하고, Sprint 1은 **BLOCK Reason Box + Unblock Checklist + Action Table**부터 구현하십시오.

# Decision Card v2 상세 방법 문서

## 1) Exec

| No | Item       | Value                                                                                              | Risk                           | Evidence                                                                                                    |
| -: | ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
|  1 | 목표         | PASS/WARN/BLOCK 판단 사유, 해제 조건, 다음 조치를 5초 이내 파악                                                      | 카드가 다시 설명형으로 비대해질 위험           | 첨부안은 현재 카드의 문제를 “판정 이유·해제 조건·다음 실행이 즉시 보이지 않음”으로 정의함                                                        |
|  2 | 핵심 구조      | Verdict Header → BLOCK Reason → Unblock Checklist → Evidence Coverage → Action Table → Audit Trace | Evidence만 많고 Action이 약하면 운영 불가 | 첨부안의 추천 구조와 P0/P1 기능 기준                                                                                     |
|  3 | 보안 원칙      | P2 원문·단가·PII는 카드에 직접 노출 금지, Material ID/요약/마스킹만 표시                                                 | NDA/PII 유출                     | Guide는 P2 원문·수치·스크린샷·내부 링크를 포함하지 않고, 자료 ID와 요약만 참조해야 함                                                      |
|  4 | Agentic UX | 승인형 실행: 요약 → 위험 → 승인/취소 → 실행 후 증거                                                                  | 자동 실행으로 승인 누락                  | Vercel AI SDK 6는 real-world action에 human approval을 요구하는 안전 계층을 제시하고 `needsApproval`을 지원함 ([Vercel][1])     |
|  5 | 접근성        | WCAG 2.2 AA 기준: Focus, Target, Drag 대체, Error 연결                                                   | 접근성 차단 시 Stop                  | WCAG 2.2는 testable success criteria이며 Focus Not Obscured, Target Size, Dragging Movements 등이 추가됨 ([W3C][2]) |

## 2) EN Sources ≤3

1. **OpenAI Responses API** — 신규 agent-like 앱에는 Responses API가 권장되며, web/file/computer/code/MCP 등 built-in tools와 Items 구조를 지원합니다. ([OpenAI Platform][3])
2. **Vercel AI SDK 6** — tool execution approval과 `needsApproval` 기반 human-in-the-loop 제어를 제공합니다. ([Vercel][1])
3. **W3C WCAG 2.2** — 접근성 기준은 testable success criteria로 작성되며, WCAG 2.2는 Focus Not Obscured, Dragging Movements, Target Size, Consistent Help 등을 포함합니다. ([W3C][2])

---

# 3) 문서 목적

이 문서는 기존 카드 UI를 다음 기준의 **운영 의사결정 카드**로 전환하는 방법을 정의합니다.

```text
1. 지금 PASS / WARN / BLOCK 중 무엇인가
2. 왜 그런가
3. 무엇을 넣으면 해제되는가
4. 누가 다음 조치를 해야 하는가
5. 어떤 근거와 승인 로그가 남았는가
```

## 적용 범위

| 영역  | 포함                                          | 제외                  |
| --- | ------------------------------------------- | ------------------- |
| UI  | Card, Tabs, Drawer, Badge, Table, Banner    | 전체 대시보드 리디자인        |
| 데이터 | Verdict, Evidence, Rule, Action, Trace JSON | P2 원문, 실단가, 계약 원문   |
| 기능  | BLOCK 해제, Evidence 확인, Human-gate, Export   | 자동 승인, 자동 송신, 자동 정산 |
| 검증  | E2E, a11y, audit trace, regression          | 실제 계약/운임 검증         |

가정: 구현 환경은 React/Next.js 계열 웹 대시보드이며, 백엔드는 카드 판단 결과를 JSON으로 제공합니다. 실제 stack이 다르면 컴포넌트명과 명령만 조정하십시오.

---

# 4) 카드 v2 정보 구조

## 4.1 최종 레이아웃

```text
┌──────────────────────────────────────────────────────────────┐
│ [VERDICT: BLOCK] [Risk: Cost Evidence Missing] [PII: Masked] │
│ Reason: Cost/Invoice 판단에 필수 evidence 부족               │
│ Unblock: InvoiceLine + RateRef + TariffRef + BOE/DO Evidence │
├──────────────────────────────────────────────────────────────┤
│ Human-gate Banner                                             │
│ 이 카드는 승인 전 Invoice approval / Cost judgment / Report   │
│ publication을 차단합니다.                                    │
├──────────────────────────────────────────────────────────────┤
│ Executive Summary                                             │
│ - 현재 상태: BLOCK                                            │
│ - 영향: CostGuard 판단 불가, dry-run report만 허용            │
│ - 다음 조치: Cost Owner가 missing evidence 업로드             │
├──────────────────────────────────────────────────────────────┤
│ Evidence Coverage                                             │
│ Master PASS | Ops PASS | Cost BLOCK | Doc WARN | Port PASS    │
├──────────────────────────────────────────────────────────────┤
│ Action Queue                                                  │
│ Owner | Action | Due | Gate | Evidence | Status               │
├──────────────────────────────────────────────────────────────┤
│ Tabs: Summary | Evidence | Actions | Validation | Trace       │
└──────────────────────────────────────────────────────────────┘
```

## 4.2 상단 Verdict Header

| 필드              | 표시값                         | 규칙              |
| --------------- | --------------------------- | --------------- |
| Verdict         | PASS / WARN / BLOCK         | 카드 최상단 고정       |
| Primary Reason  | 1줄                          | “왜 막혔는지”만 표시    |
| Unblock Summary | 1줄                          | 필요한 입력 3~5개만 표시 |
| PII Badge       | `PII: None / Masked / Risk` | 혼합 문구 금지        |
| Generated At    | UTC 또는 Asia/Dubai           | Trace 탭에도 동일 저장 |

### UI 문구 예시

```text
VERDICT: BLOCK
Reason: Cost evidence missing
Unblock: InvoiceLine + RateRef + TariffRef + BOE/DO Evidence
PII Status: Masked
```

---

# 5) Verdict 판정 로직

## 5.1 기본 상태 정의

| Verdict | 의미                                | 허용 행동                                            | 차단 행동                                               |
| ------- | --------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| PASS    | 필수 evidence 충족, 승인 조건 충족          | 보고서 발행, 승인 요청, export                            | 없음. 단 P2 export는 별도 승인                              |
| WARN    | 운영 가능하나 일부 evidence/confidence 약함 | dry-run, 내부 검토, 보완 요청                            | 자동 승인, 외부 발행                                        |
| BLOCK   | 필수 evidence/승인/보안 조건 미충족          | KPI dashboard, dry-run report, human-gate review | Invoice approval, Cost judgment, Report publication |

## 5.2 BLOCK 조건

아래 중 하나라도 true이면 `BLOCK`입니다.

```text
1. requiredEvidence 중 하나라도 없음
2. Cost / Invoice / Tariff / BOE / DO 판단에 evidence가 없음
3. PII Status = Risk
4. P2 원문 또는 단가가 마스킹 없이 표시됨
5. approvalRequired = true인데 approvalStatus != approved
6. reportPublicationGuard = failed
7. confidence가 high-risk 판단 기준 미만
```

가정: confidence 기준은 아래처럼 시작합니다. 실제 운영 로그가 쌓이면 Stage 7에서 조정하십시오.

| 구간     |        기준 | 처리                     |
| ------ | --------: | ---------------------- |
| High   |   0.80 이상 | PASS 가능                |
| Medium | 0.60–0.79 | WARN                   |
| Low    |   0.60 미만 | BLOCK 또는 manual review |

---

# 6) 데이터 스키마

## 6.1 DecisionCardPayload

```json
{
  "cardId": "DC-20260517-0001",
  "routeId": "ROUTE-REDACTED-001",
  "generatedAt": "2026-05-17T18:30:00+04:00",
  "verdict": "BLOCK",
  "severity": "P0",
  "primaryReason": "Cost evidence missing",
  "unblockSummary": "InvoiceLine + RateRef + TariffRef + BOE/DO evidence required",
  "piiStatus": "Masked",
  "dataClass": "P1",
  "blockedBy": [
    {
      "ruleId": "SCT-COST-001",
      "ruleName": "Cost evidence required",
      "reason": "Cost or invoice decision requires evidence",
      "requiredInputs": [
        "InvoiceLine",
        "RateRef",
        "TariffRef",
        "BOE/DO/Port evidence"
      ],
      "missingInputs": [
        "RateRef",
        "TariffRef"
      ],
      "severity": "P0"
    }
  ],
  "allowedActions": [
    "Build KPI dashboard",
    "Create dry-run report",
    "Request human-gate review"
  ],
  "blockedActions": [
    "Invoice approval",
    "Cost judgment",
    "Report publication without approval"
  ],
  "evidenceCoverage": [
    {
      "domain": "Master",
      "status": "PASS",
      "required": 3,
      "available": 3
    },
    {
      "domain": "Cost",
      "status": "BLOCK",
      "required": 4,
      "available": 2
    }
  ],
  "actions": [
    {
      "actionId": "ACT-001",
      "owner": "Cost Owner",
      "action": "Upload missing RateRef and TariffRef",
      "dueAt": "2026-05-18T12:00:00+04:00",
      "gate": "Human approval required",
      "evidenceStatus": "Missing",
      "status": "Open"
    }
  ],
  "trace": {
    "sourceHash": "sha256:redacted",
    "rulePackVersion": "2026.05",
    "promptVersion": "prompt-redacted-v3",
    "approvalActor": null,
    "approvalStatus": "Not requested"
  }
}
```

## 6.2 EvidenceItem

```json
{
  "evidenceId": "E-001",
  "domain": "Cost",
  "docType": "RateRef",
  "docTitle": "RATE-REF-REDACTED",
  "section": "Freight / Surcharge",
  "snippetRedacted": "Rate basis exists, amount masked",
  "confidence": 0.82,
  "sourceHash": "sha256:redacted",
  "dataClass": "P1",
  "piiStatus": "Masked",
  "usableForDecision": true
}
```

## 6.3 ActionItem

```json
{
  "actionId": "ACT-001",
  "ownerRole": "Cost Owner",
  "ownerNameMasked": "User-Redacted",
  "actionType": "REQUEST_INPUT",
  "actionLabel": "Submit missing RateRef",
  "requiredInput": "RateRef",
  "approvalRequired": true,
  "approvalStatus": "Pending",
  "status": "Open",
  "evidenceIds": ["E-001"],
  "blockedUntil": ["RateRef", "TariffRef"]
}
```

---

# 7) 컴포넌트 설계

## 7.1 컴포넌트 목록

| No | Component             | 역할                                  | 필수 상태                           |
| -: | --------------------- | ----------------------------------- | ------------------------------- |
|  1 | `DecisionCard`        | 전체 컨테이너                             | Loading / Empty / Error / Ready |
|  2 | `VerdictHeader`       | PASS/WARN/BLOCK, reason, unblock 표시 | PASS / WARN / BLOCK             |
|  3 | `BlockReasonBox`      | BLOCK 사유와 ruleId 표시                 | visible only when BLOCK         |
|  4 | `UnblockChecklist`    | 해제 입력값 체크리스트                        | missing / provided / invalid    |
|  5 | `HumanGateBanner`     | 승인 필요 행동 경고                         | approval required / approved    |
|  6 | `EvidenceCoverageBar` | domain별 evidence 상태                 | PASS / WARN / BLOCK             |
|  7 | `ActionTable`         | owner/action/due/gate/status        | open / pending / done           |
|  8 | `EvidenceDrawer`      | evidence 상세, snippet, confidence    | open / closed                   |
|  9 | `TracePanel`          | routeId/sourceHash/generatedAt      | redacted / available            |
| 10 | `ExportControls`      | Copy JSON / Export PDF              | dry-run / approved              |

## 7.2 `VerdictHeader` 규칙

```text
- 화면 첫 영역에 고정한다.
- reason은 80자 이내.
- unblock은 최대 5개 입력까지만 표시하고, 초과분은 "+N more".
- PASS/WARN/BLOCK 색상만으로 의미를 전달하지 않는다.
- badge에는 텍스트를 반드시 포함한다.
```

## 7.3 `BlockReasonBox` 규칙

BLOCK이면 반드시 아래 4개를 표시합니다.

```text
1. Blocked by: ruleId + ruleName
2. Reason: 사람이 읽을 수 있는 설명
3. Required inputs: 해제에 필요한 입력
4. Blocked actions: 현재 금지된 행동
```

예시:

```text
Why BLOCK?
Blocked by: SCT-COST-001 / Cost evidence required
Reason: Cost or invoice decision requires evidence.
Required: InvoiceLine, RateRef, TariffRef, BOE/DO evidence
Blocked: Invoice approval, Cost judgment, Report publication
```

## 7.4 `UnblockChecklist` 규칙

| 상태               | UI                  | 클릭 시 동작               |
| ---------------- | ------------------- | --------------------- |
| Missing          | 체크 안 됨 + `Required` | 해당 입력 업로드/연결 모달       |
| Provided         | 체크됨 + `Linked`      | Evidence Drawer       |
| Invalid          | 경고 + `Invalid`      | Validation 탭으로 이동     |
| Pending Approval | 시계 + `Pending`      | Human-gate Banner로 이동 |

---

# 8) 탭 설계

## 8.1 Summary 탭

목적: PM/임원/현장 책임자가 빠르게 판단.

```text
- Verdict
- Primary reason
- Business impact
- Next action
- Owner
- Due
```

## 8.2 Evidence 탭

목적: 감사/검증.

| Evidence ID | Domain | Doc Type | Section     | Confidence | PII    | Usable |
| ----------- | ------ | -------- | ----------- | ---------: | ------ | ------ |
| E-001       | Cost   | RateRef  | Freight     |       0.82 | Masked | Yes    |
| E-002       | Ops    | BOE      | Declaration |       0.76 | None   | Warn   |

클릭 시 Drawer:

```text
Evidence ID: E-001
Doc: RATE-REF-REDACTED
Section: Freight / Surcharge
Snippet: Rate basis exists, amount masked
Confidence: 0.82
Source Hash: sha256:redacted
Data Class: P1
```

## 8.3 Actions 탭

목적: 운영 실행.

| Owner      | Action            | Due              | Gate              | Evidence | Status  |
| ---------- | ----------------- | ---------------- | ----------------- | -------- | ------- |
| Cost Owner | Upload RateRef    | 2026-05-18 12:00 | Approval required | Missing  | Open    |
| Docs Owner | Link BOE evidence | 2026-05-18 15:00 | None              | E-002    | Pending |

## 8.4 Validation 탭

목적: 시스템 검증.

| Rule ID      | Severity | Message                         | Result |
| ------------ | -------- | ------------------------------- | ------ |
| SCT-COST-001 | P0       | Cost decision requires evidence | BLOCK  |
| SCT-PII-002  | P0       | PII must be masked              | PASS   |

## 8.5 Trace 탭

목적: audit.

```text
generatedAt
routeId
sourceHash
rulePackVersion
promptVersion
approvalActor
approvalStatus
sensitiveAccessed
```

OpenAI의 Responses API는 결과를 Items 구조로 다루며 message, function_call, function_call_output 같은 단위를 표현할 수 있으므로, 카드 Trace에는 “판단 결과”뿐 아니라 “어떤 tool/action/evidence가 판단에 사용됐는지”를 남기는 구조가 적합합니다. ([OpenAI Platform][3])

---

# 9) Human-gate 설계

## 9.1 승인 필요 액션

아래 액션은 기본적으로 승인 전 실행 금지입니다.

```text
- Invoice approval
- Cost judgment
- Report publication
- External send/share
- P2 material export
- irreversible tool execution
```

## 9.2 승인 UI 최소 구성

```text
1. 실행 요약: 무엇을 실행하는가
2. 대상 데이터: 어떤 route/evidence/material을 쓰는가
3. 위험: 되돌릴 수 있는가
4. 승인/취소 버튼
5. 실행 후 trace: 누가/언제/무엇을 승인했는가
```

Vercel AI SDK 6 기준으로 real-world action을 수행하는 agent에는 human approval이 안전 계층으로 필요하며, `needsApproval` 같은 승인 플래그를 통해 실행 전 제어할 수 있습니다. ([Vercel][1])

---

# 10) 보안·마스킹 규칙

## 10.1 PII Badge 표준

| Badge         | 의미               | 허용    |
| ------------- | ---------------- | ----- |
| `PII: None`   | PII 없음           | 표시 가능 |
| `PII: Masked` | PII 감지 후 마스킹     | 표시 가능 |
| `PII: Risk`   | PII 의심 또는 마스킹 실패 | BLOCK |

## 10.2 P2 데이터 처리

| 데이터    | 카드 표시                              | 원문 접근            |
| ------ | ---------------------------------- | ---------------- |
| 계약 원문  | 조항 ID + 요약                         | 별도 Materials 저장소 |
| 단가     | RateRef ID / 범위 / Masked           | 권한 필요            |
| 실명/연락처 | masked owner                       | 권한 필요            |
| 내부 링크  | 표시 금지                              | 권한 필요            |
| BOE/DO | 문서 ID + section + redacted snippet | 권한 필요            |

프로젝트 가이드는 P2 자료를 별도 권한 저장소에 두고, Guide에는 자료 ID와 요약만 참조하도록 규정합니다. 따라서 카드도 “원문 렌더링”이 아니라 `Material ID → redacted snippet → sourceHash` 방식으로 설계해야 합니다. 

---

# 11) 구현 단계

## Step 1 — 현 카드 inventory

현재 카드에서 아래 필드를 추출합니다.

```text
- verdict
- summary
- route documents
- evidence IDs
- next actions
- PII status
- generatedAt
- routeId
- sourceHash
```

산출물:

```text
docs/traceability/card-v1-inventory.md
```

## Step 2 — Rule matrix 작성

```markdown
| Rule ID | Condition | Verdict | Required Inputs | Blocked Actions |
|---|---|---|---|---|
| SCT-COST-001 | Cost evidence missing | BLOCK | InvoiceLine, RateRef, TariffRef | Cost judgment |
| SCT-PII-002 | PII unmasked | BLOCK | Redaction proof | Export, Publish |
| SCT-APP-003 | Approval missing | BLOCK | Approval actor | Send, Publish |
```

## Step 3 — JSON contract 고정

프론트와 백엔드 사이의 계약은 `DecisionCardPayload` 하나로 고정합니다.

```text
schema/decision-card.schema.json
```

필수 필드:

```text
cardId
generatedAt
verdict
primaryReason
blockedBy[]
evidenceCoverage[]
actions[]
trace
piiStatus
```

## Step 4 — UI component 분리

권장 파일 구조:

```text
src/features/decision-card/
  DecisionCard.tsx
  VerdictHeader.tsx
  BlockReasonBox.tsx
  UnblockChecklist.tsx
  HumanGateBanner.tsx
  EvidenceCoverageBar.tsx
  ActionTable.tsx
  EvidenceDrawer.tsx
  TracePanel.tsx
  decision-card.schema.ts
  decision-card.rules.ts
  decision-card.test.tsx
```

## Step 5 — 상태 머신 구현

```ts
type Verdict = "PASS" | "WARN" | "BLOCK";
type EvidenceStatus = "PASS" | "WARN" | "BLOCK";
type PiiStatus = "None" | "Masked" | "Risk";
type ApprovalStatus = "NotRequired" | "Pending" | "Approved" | "Rejected";

function deriveVerdict(input: {
  missingRequiredInputs: string[];
  piiStatus: PiiStatus;
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  lowConfidenceHighRisk: boolean;
}): Verdict {
  if (input.piiStatus === "Risk") return "BLOCK";
  if (input.missingRequiredInputs.length > 0) return "BLOCK";
  if (input.approvalRequired && input.approvalStatus !== "Approved") return "BLOCK";
  if (input.lowConfidenceHighRisk) return "BLOCK";
  return "PASS";
}
```

## Step 6 — Evidence Drawer 연결

```text
사용자가 E-001 클릭
→ Drawer open
→ redacted snippet 표시
→ sourceHash 표시
→ confidence 표시
→ 원문 보기 버튼은 권한 있을 때만 표시
```

원문 보기 버튼은 기본 hidden이 아니라 **disabled + reason**으로 표시하는 것이 운영상 낫습니다.

```text
[View original disabled]
Reason: P2 material requires approved access.
```

## Step 7 — Action Table을 운영 큐로 전환

Action은 단순 추천 문장이 아니라 실행 가능한 작업 큐로 관리합니다.

```text
Owner
Action
Required Input
Due
Gate
Evidence Status
Current Status
```

상태값:

```text
Open
Pending Input
Pending Approval
Done
Rejected
Expired
```

## Step 8 — Export 제어

Export는 3단계로 분리합니다.

| Export           | 조건              | 내용                 |
| ---------------- | --------------- | ------------------ |
| Copy JSON        | 항상 가능           | redacted payload   |
| Export PDF Draft | WARN/BLOCK 가능   | watermark: DRY-RUN |
| Publish Report   | PASS + approval | audit trace 포함     |

---

# 12) 접근성 DoD

WCAG 2.2는 성공 기준을 testable statement로 제시하므로, 카드 컴포넌트도 테스트 가능한 DoD로 관리해야 합니다. ([W3C][2])

| Component        | DoD                                            |
| ---------------- | ---------------------------------------------- |
| VerdictHeader    | 색상 없이도 PASS/WARN/BLOCK 텍스트 식별 가능               |
| BlockReasonBox   | 키보드 포커스 시 sticky header/footer에 가려지지 않음        |
| UnblockChecklist | checkbox 상태가 스크린리더에 전달됨                        |
| EvidenceDrawer   | ESC로 닫힘, focus trap, 닫은 뒤 원래 trigger로 focus 복귀 |
| ActionTable      | header와 cell 관계 명확, keyboard sorting 가능        |
| HumanGateBanner  | 승인/취소 버튼 target size 충족                        |
| ExportControls   | destructive/publish action은 확인 dialog 제공       |

Focus Not Obscured 기준은 키보드 포커스를 받은 UI 컴포넌트가 작성자 콘텐츠에 의해 완전히 가려지지 않아야 한다는 내용입니다. sticky header/footer가 있는 대시보드에서는 `scroll-padding`, drawer focus trap, banner offset을 반드시 테스트하십시오. ([W3C][4])

---

# 13) Options A/B/C

| Option | 범위                                                 | 외부비(AED) | Risk   | Time     | 적합 상황             |
| ------ | -------------------------------------------------- | -------: | ------ | -------- | ----------------- |
| A      | Front-only UI 재배치: Header, BLOCK Box, Action Table |  0.00 가정 | Medium | 2–3 MD   | 백엔드 변경이 어려운 경우    |
| B      | JSON contract + UI + rule matrix                   |  0.00 가정 | Low    | 5–8 MD   | 운영 카드 v2 정식 적용    |
| C      | B + audit trace + approval gate + E2E/a11y CI      |  0.00 가정 | Low    | 10–15 MD | 보고서 발행/정산/승인까지 연결 |

가정: 외부 SaaS/라이선스 추가비는 AED 0.00으로 두었습니다. 내부 인건비 단가는 미제공이므로 금액 산정은 ZERO 처리합니다.

권장: **Option B → Option C** 순서입니다. A는 빠르지만 판단 로직과 evidence trace가 약해 재작업 가능성이 큽니다.

---

# 14) 검증 시나리오

## 14.1 E2E 시나리오

| No | Scenario                       | Input                               | Expected                               |
| -: | ------------------------------ | ----------------------------------- | -------------------------------------- |
|  1 | Cost evidence missing          | RateRef 없음                          | Verdict = BLOCK                        |
|  2 | PII risk                       | phone unmasked                      | Verdict = BLOCK, Export disabled       |
|  3 | Approval missing               | publish requested, approval pending | Publish blocked                        |
|  4 | Evidence click                 | E-001 클릭                            | Drawer opens with redacted snippet     |
|  5 | All required evidence provided | requiredInputs complete             | Verdict = PASS or WARN                 |
|  6 | Keyboard navigation            | Tab sequence                        | Header → Checklist → Actions → Tabs 순서 |

## 14.2 Acceptance Criteria

```text
AC-01: BLOCK 카드 최상단에 reason과 unblock inputs가 보인다.
AC-02: 사용자는 1 click 이내에 missing evidence 목록을 확인한다.
AC-03: Evidence ID 클릭 시 doc, section, redacted snippet, confidence가 보인다.
AC-04: PII Status는 None / Masked / Risk 중 하나만 표시한다.
AC-05: PII Risk이면 Copy JSON 외 모든 export/publish는 차단한다.
AC-06: 승인 필요 action은 approval actor 없이는 실행되지 않는다.
AC-07: 모든 action은 owner, due, gate, evidence status를 가진다.
AC-08: Trace 탭은 generatedAt, routeId, sourceHash, rulePackVersion을 표시한다.
AC-09: Keyboard-only 사용자가 모든 탭과 drawer를 사용할 수 있다.
AC-10: E2E-smoke, a11y-smoke, report-bundle 결과가 traceability에 저장된다.
```

---

# 15) cmd3

프로젝트 명령에 맞게 script 이름만 조정하십시오.

```bash
pnpm lint && pnpm typecheck
```

```bash
pnpm test && pnpm build
```

```bash
pnpm exec playwright test tests/decision-card-v2.spec.ts
```

추가 권장:

```bash
pnpm exec playwright test tests/decision-card-a11y.spec.ts
```

프로젝트 가이드는 로컬 Quick Check를 `lint/typecheck → unit/integration → build → E2E-smoke → a11y-smoke → report-bundle` 순서로 권장합니다. 

---

# 16) Traceability Bundle

아래 파일을 PR 산출물로 고정하십시오.

```text
docs/traceability/decision-log.md
docs/traceability/simulation-log.md
docs/traceability/validation-report.md
docs/traceability/changelog.md
docs/traceability/screenshots/
docs/traceability/perf/
```

Decision Log 예시:

```markdown
# Decision Log

Date: 2026-05-17
Context: Decision Card v1 does not expose BLOCK reason and unblock inputs clearly.
Options:
- A: Front-only layout update
- B: Schema + UI + rule matrix
- C: Full approval/audit pipeline
Decision: Option B first, then C.
Rationale: Actionability and traceability require schema-level contract.
Validation: E2E + a11y + redaction test.
```

Simulation Log 예시:

```markdown
# Simulation Log

Scenario: Cost evidence missing
Input: RateRef missing, TariffRef missing
Steps:
1. Load DecisionCardPayload
2. Run deriveVerdict()
3. Render DecisionCard
Output:
- Verdict = BLOCK
- UnblockChecklist shows RateRef, TariffRef
- Cost judgment disabled
Verdict: Pass
Next:
1. Add approval gate test
2. Add PII Risk test
3. Add export dry-run test
```

---

# 17) ZERO Log

| 단계       | 이유                              | 위험          | 요청데이터                                     | 다음조치               |
| -------- | ------------------------------- | ----------- | ----------------------------------------- | ------------------ |
| Data     | P2 원문·단가·PII가 카드 payload에 직접 포함 | NDA/PII 유출  | Material ID, redacted snippet, sourceHash | 원문 제거 후 재검증        |
| Rule     | requiredEvidence 기준 없음          | 잘못된 PASS    | rule matrix, required inputs              | Rule matrix 작성     |
| Approval | publish/export가 승인 없이 가능        | 무단 보고서 발행   | approval actor/status                     | Human-gate 추가      |
| A11y     | drawer/table 키보드 접근 불가          | 접근성 차단      | a11y test log                             | 수정 전 release 중단    |
| KPI      | 카드 개선 후 Time-to-Decision 측정 불가  | 개선 효과 입증 불가 | event schema                              | analytics event 추가 |

최종 우선순위는 아래로 고정합니다.

```text
P0: BLOCK Reason Box + Unblock Checklist + Human-gate Banner
P1: Evidence Coverage Bar + Action Table + Evidence Drawer
P2: Route Docs 접기 + PII Badge + Copy JSON / Export PDF
P3: Diff View + Audit Timeline
```

[1]: https://vercel.com/blog/ai-sdk-6 "AI SDK 6 - Vercel"
[2]: https://www.w3.org/TR/WCAG22/ "Web Content Accessibility Guidelines (WCAG) 2.2"
[3]: https://platform.openai.com/docs/guides/responses-vs-chat-completions "Migrate to the Responses API | OpenAI API"
[4]: https://www.w3.org/WAI/WCAG22/quickref/ "How to Meet WCAG (Quickref Reference)"
