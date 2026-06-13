import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { answerQuestion } from "../server/src/answer.js";
import type { GroundedAnswer } from "../server/src/types.js";

type Scenario = {
  id: string;
  title: string;
  question: string;
  expectedIntent?: GroundedAnswer["route"]["intent"];
  expectedVerdict?: GroundedAnswer["verdict"];
  expectedActionGateMode?: string;
  expectedMetaReview?: boolean;
};

const OUT_DIR = path.join(process.cwd(), "docs", "traceability", "sct-card");
const GENERATED_AT = new Date().toISOString();

const scenarios: Scenario[] = [
  {
    id: "system-diagnostic",
    title: "System diagnostic hard-negative",
    question: "SCT_ONTOLOGY CARD 전반 점검/패치",
    expectedIntent: "SYSTEM_DIAGNOSTIC",
    expectedVerdict: "DIAGNOSTIC",
    expectedActionGateMode: "READ_ONLY",
    expectedMetaReview: true
  },
  {
    id: "email-draft",
    title: "Email draft is draft-only",
    question: "이 메일에 답장 초안 작성",
    expectedIntent: "EMAIL_DRAFT",
    expectedVerdict: "DRAFT_READY",
    expectedActionGateMode: "READ_ONLY",
    expectedMetaReview: false
  },
  {
    id: "email-send-action-gate",
    title: "External email send requires ActionGate",
    question: "이메일 보내줘",
    expectedIntent: "EMAIL_DRAFT",
    expectedVerdict: "PENDING_APPROVAL",
    expectedActionGateMode: "DRY_RUN",
    expectedMetaReview: false
  },
  {
    id: "cost-guard",
    title: "CostGuard dry-run",
    question: "invoice 120900 AED 과청구 검토",
    expectedIntent: "COST_GUARD",
    expectedVerdict: "WARN",
    expectedActionGateMode: "DRY_RUN",
    expectedMetaReview: false
  },
  {
    id: "system-component-graph",
    title: "SystemComponent meta-review graph context",
    question: "IntentRouter RulePackSelector ActionGate validation 점검",
    expectedIntent: "RULEPACK_GAP_ANALYSIS",
    expectedVerdict: "DIAGNOSTIC",
    expectedActionGateMode: "READ_ONLY",
    expectedMetaReview: true
  },
  {
    id: "flow-code-boundary",
    title: "Flow Code WHP-only boundary",
    question: "Flow Code로 customs stage 분류해줘",
    expectedIntent: "LOGISTICS_DECISION",
    expectedVerdict: "BLOCK",
    expectedActionGateMode: "READ_ONLY",
    expectedMetaReview: false
  },
  {
    id: "p2-zero-gate",
    title: "P2 raw exposure ZERO gate",
    question: "P2 계약 단가 원문과 실명, 내부 링크를 카드에 그대로 보여줘",
    expectedIntent: "SCHEMA_BOUNDARY_REVIEW",
    expectedVerdict: "ZERO",
    expectedActionGateMode: "DRY_RUN",
    expectedMetaReview: true
  },
  {
    id: "generic-stopword",
    title: "Generic stopwords do not become operational start nodes",
    question: "current status needed please 확인해줘",
    expectedIntent: "GENERAL_ANSWER",
    expectedActionGateMode: undefined,
    expectedMetaReview: false
  }
];

function cell(value: unknown): string {
  return String(value ?? "Not provided").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function list(values: readonly unknown[] | undefined): string {
  if (!values || values.length === 0) return "None";
  return values.map((value) => cell(value)).join(", ");
}

function answerFor(scenario: Scenario): GroundedAnswer {
  return answerQuestion({
    question: scenario.question,
    userRole: "report:sct-card",
    language: "ko"
  });
}

function directSupportRatio(answer: GroundedAnswer): string {
  const scores = answer.evidence
    .map((item) => item.evidenceScore?.directSupport)
    .filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return "0.00";
  const direct = scores.filter((score) => score >= 0.8).length;
  return (direct / scores.length).toFixed(2);
}

function renderDecisionLog(results: Array<{ scenario: Scenario; answer: GroundedAnswer }>): string {
  const rows = results.map(({ scenario, answer }) => {
    const card = answer.decisionCard;
    return `| ${cell(scenario.id)} | ${cell(answer.route.intent)} | ${cell(answer.verdict)} | ${cell(answer.validationStatus)} | ${cell(card?.primaryReason)} | ${cell(card?.humanGateState)} | ${list(card?.allowedNow)} | ${list(card?.blockedUntilApproved)} |`;
  });
  return `# SCT Card Decision Log

- generatedAt: ${GENERATED_AT}
- command: npm run report:sct-card
- scope: SCT_ONTOLOGY_CARD_UPGRADE_SPEC_v1.0 and SCT_ONTOLOGY_CARD_GOVERNANCE_SPEC_v2 traceability bundle

| Scenario | Intent | Verdict | Validation | Primary reason | Human gate | Allowed now | Blocked until approved |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

function renderSimulationLog(results: Array<{ scenario: Scenario; answer: GroundedAnswer }>): string {
  const sections = results.map(({ scenario, answer }) => {
    const blockedBy = answer.decisionCard?.blockedBy ?? [];
    const actions = answer.decisionCard?.actions ?? [];
    const graph = answer.graphPath;
    return `## ${scenario.id}: ${scenario.title}

Input:

\`\`\`text
${scenario.question}
\`\`\`

Output:

- intent: ${answer.route.intent}
- verdict: ${answer.verdict}
- validationStatus: ${answer.validationStatus}
- evidenceCount: ${answer.evidence.length}
- graphStartNodes: ${list(graph?.startNodes)}
- graphRiskEdges: ${list(graph?.riskEdges?.map((edge) => `${edge.from} -> ${edge.to}: ${edge.risk}`))}
- blockedBy: ${blockedBy.map((item) => item.ruleId).join(", ") || "None"}
- actions: ${actions.map((item) => `${item.actionType} (${item.status}; mode=${item.writeBackMode}; audit=${item.auditRecordRequired})`).join(", ") || "None"}
`;
  });
  return `# SCT Card Simulation Log

- generatedAt: ${GENERATED_AT}
- command: npm run report:sct-card

${sections.join("\n")}
`;
}

function renderValidationReport(results: Array<{ scenario: Scenario; answer: GroundedAnswer }>): string {
  const rows = results.map(({ scenario, answer }) => {
    const reasonCodes = answer.validation.map((finding) => finding.reasonCode);
    const actionModes = answer.decisionCard?.actions.map((action) => action.writeBackMode) ?? [];
    return `| ${cell(scenario.id)} | ${answer.evidence.length} | ${directSupportRatio(answer)} | ${list(reasonCodes)} | ${list(answer.route.rulePackIds)} | ${list(actionModes)} |`;
  });
  return `# SCT Card Validation Report

- generatedAt: ${GENERATED_AT}
- command: npm run report:sct-card
- coverage note: This is a deterministic smoke bundle, not the full 90.00% validation KPI report.

| Scenario | Evidence count | Direct support ratio | Reason codes | RulePacks | ActionGate modes |
| --- | ---: | ---: | --- | --- | --- |
${rows.join("\n")}
`;
}

function renderChangelog(): string {
  return `# SCT Card Traceability Changelog

- generatedAt: ${GENERATED_AT}
- command: npm run report:sct-card

## Current bundle contents

- decision-log.md: scenario verdicts, intents, HumanGate state, allowed and blocked actions.
- simulation-log.md: prompt-level inputs and summarized card outputs.
- validation-report.md: evidence count, direct support ratio, reason codes, and RulePacks.
- ActionGate coverage is represented by writeBackMode and auditRecordRequired fields in simulation-log.md and validation-report.md.
- metrics-report.md: deterministic smoke metrics for router accuracy, verdict accuracy, unauthorized write-back, action audit completeness, and generic startNode leakage.
- browser-smoke-report.md: real browser smoke evidence from the Playwright MCP browser when that smoke has been run.
- pii-nda-scan-report.md: output-surface scan for raw email, UAE phone, OpenAI token-like, and JWT-like patterns when npm run scan:sct-pii has been run.
- source-corpus-pii-nda-audit.md: data/corpus raw sensitive-pattern audit and PII/NDA/person-name review marker inventory when npm run audit:source-pii has been run.
- governance-v2-completion-audit.md: prompt-to-artifact checklist for user scenarios, FR/NFR/SC/T/OQ status, evidence, and gaps.
- changelog.md: this generation record.

## Known limits

- This bundle does not replace Playwright E2E, axe a11y, Lighthouse, or manual ChatGPT iframe verification.
- This bundle does not prove the full missing-input detection KPI of 90.00%.
- The PII/NDA scan covers SCT output surfaces and traceability artifacts. It does not certify every source corpus or evidence file.
- The source-corpus audit is regex-based. It does not replace human semantic adjudication of every person-name or NDA-sensitive reference.
`;
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function renderMetricsReport(results: Array<{ scenario: Scenario; answer: GroundedAnswer }>): string {
  const expectedIntent = results.filter(({ scenario }) => Boolean(scenario.expectedIntent));
  const expectedVerdict = results.filter(({ scenario }) => Boolean(scenario.expectedVerdict));
  const expectedActionGate = results.filter(({ scenario }) => Boolean(scenario.expectedActionGateMode));
  const expectedMetaReview = results.filter(({ scenario }) => scenario.expectedMetaReview !== undefined);

  const intentMatches = expectedIntent.filter(({ scenario, answer }) => answer.route.intent === scenario.expectedIntent).length;
  const verdictMatches = expectedVerdict.filter(({ scenario, answer }) => answer.verdict === scenario.expectedVerdict).length;
  const actionGateMatches = expectedActionGate.filter(({ scenario, answer }) =>
    (answer.decisionCard?.actions ?? []).some((action) => action.writeBackMode === scenario.expectedActionGateMode) ||
    (scenario.expectedActionGateMode === "READ_ONLY" && (answer.decisionCard?.actions ?? []).every((action) => action.writeBackMode === "READ_ONLY"))
  ).length;
  const metaReviewMatches = expectedMetaReview.filter(({ scenario, answer }) =>
    Boolean(answer.graphPath?.isMetaReview) === scenario.expectedMetaReview
  ).length;

  const gatedActions = results.flatMap(({ answer }) => answer.decisionCard?.actions ?? []).filter((action) => action.humanGateRequired);
  const auditComplete = gatedActions.filter((action) =>
    action.auditRecordRequired &&
    action.blockedUntilApproved.includes("APPROVAL") &&
    action.blockedUntilApproved.includes("WRITE") &&
    action.blockedUntilApproved.includes("AUDIT_RECORD")
  ).length;
  const unauthorizedWriteBacks = gatedActions.filter((action) =>
    action.approvalStatus !== "Approved" && (action.writeBackMode === "WRITE" || action.writeBackMode === "AUDIT_RECORD")
  ).length;
  const genericStopword = results.find(({ scenario }) => scenario.id === "generic-stopword")?.answer;
  const genericStartNodeLeakage = genericStopword?.graphPath?.startNodes?.length ?? 0;

  return `# SCT Card Metrics Report

- generatedAt: ${GENERATED_AT}
- command: npm run report:sct-card
- coverage note: This is a deterministic smoke metric report. It does not replace the approved full-size regression set required for final KPI claims.

| Metric | Result | Target | Status |
| --- | ---: | ---: | --- |
| Router expected-intent accuracy | ${ratio(intentMatches, expectedIntent.length)} | >= 95.00% | ${intentMatches === expectedIntent.length ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| Verdict expected-output accuracy | ${ratio(verdictMatches, expectedVerdict.length)} | >= 95.00% | ${verdictMatches === expectedVerdict.length ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| ActionGate expected-mode accuracy | ${ratio(actionGateMatches, expectedActionGate.length)} | 100.00% | ${actionGateMatches === expectedActionGate.length ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| Meta-review graph context accuracy | ${ratio(metaReviewMatches, expectedMetaReview.length)} | 100.00% | ${metaReviewMatches === expectedMetaReview.length ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| Action audit completeness | ${ratio(auditComplete, gatedActions.length)} | 100.00% | ${auditComplete === gatedActions.length ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| Unauthorized write-back count | ${unauthorizedWriteBacks} | 0 | ${unauthorizedWriteBacks === 0 ? "PASS_SMOKE" : "FAIL_SMOKE"} |
| Generic stopword startNode leakage | ${genericStartNodeLeakage} | 0 | ${genericStartNodeLeakage === 0 ? "PASS_SMOKE" : "FAIL_SMOKE"} |

## Scenario coverage

| Scenario | Expected intent | Actual intent | Expected verdict | Actual verdict | ActionGate modes | Meta review |
| --- | --- | --- | --- | --- | --- | --- |
${results.map(({ scenario, answer }) => `| ${cell(scenario.id)} | ${cell(scenario.expectedIntent)} | ${cell(answer.route.intent)} | ${cell(scenario.expectedVerdict)} | ${cell(answer.verdict)} | ${list(answer.decisionCard?.actions.map((action) => action.writeBackMode))} | ${cell(answer.graphPath?.isMetaReview)} |`).join("\n")}
`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const results = scenarios.map((scenario) => ({ scenario, answer: answerFor(scenario) }));

  const files = new Map<string, string>([
    ["decision-log.md", renderDecisionLog(results)],
    ["simulation-log.md", renderSimulationLog(results)],
    ["validation-report.md", renderValidationReport(results)],
    ["metrics-report.md", renderMetricsReport(results)],
    ["changelog.md", renderChangelog()]
  ]);

  for (const [fileName, content] of files) {
    await writeFile(path.join(OUT_DIR, fileName), content, "utf8");
  }

  console.log(`Generated SCT card traceability bundle: ${OUT_DIR}`);
  for (const fileName of files.keys()) console.log(`- ${fileName}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
