# SCT Card Decision Log

- generatedAt: 2026-06-09T16:02:42.822Z
- command: npm run report:sct-card
- scope: SCT_ONTOLOGY_CARD_UPGRADE_SPEC_v1.0 and SCT_ONTOLOGY_CARD_GOVERNANCE_SPEC_v2 traceability bundle

| Scenario | Intent | Verdict | Validation | Primary reason | Human gate | Allowed now | Blocked until approved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| system-diagnostic | SYSTEM_DIAGNOSTIC | DIAGNOSTIC | PASS | No blocking finding | READ_ONLY | read, diagnostic_report, test_scenario, Copy JSON | email_draft, external_send, cost_approval, write_back |
| email-draft | EMAIL_DRAFT | DRAFT_READY | PASS | No blocking finding | READ_ONLY | read, internal_draft, Copy JSON | external_send_without_approval, kg_mutation_without_explicit_instruction |
| email-send-action-gate | EMAIL_DRAFT | PENDING_APPROVAL | WARN | Approval is required but has not been granted | APPROVAL_REQUESTED | read, internal_draft, Copy JSON | external_send_without_approval, kg_mutation_without_explicit_instruction, Invoice approval, Publish, External send, Publish Report, External Send |
| cost-guard | COST_GUARD | WARN | WARN | Approval is required but has not been granted | APPROVAL_REQUESTED | read, dry_run, variance_report, Copy JSON | invoice_approval_without_rateref_tariffref, write_back_without_approval, Invoice approval, Publish, External send, Publish Report, External Send |
| system-component-graph | RULEPACK_GAP_ANALYSIS | DIAGNOSTIC | PASS | No blocking finding | READ_ONLY | read, diagnostic_report, test_scenario, Copy JSON | email_draft, external_send, cost_approval, write_back |
| flow-code-boundary | LOGISTICS_DECISION | BLOCK | BLOCK | Flow Code is WHP-only and must not be used as shipment route, customs stage, in… | READ_ONLY | read, dry_run, risk_memo, input_request, Copy JSON | final_authority_decision_without_evidence, write_back_without_approval, Route classification, Customs classification, Invoice bucket, Operations KPI bucket |
| p2-zero-gate | SCHEMA_BOUNDARY_REVIEW | ZERO | BLOCK | P2 raw text, rates, real names, and internal links must be redacted before any … | APPROVAL_REQUESTED | read, diagnostic_report, test_scenario, Read redacted stop notice | email_draft, external_send, cost_approval, write_back, Export, Publish, All high-risk actions, Invoice approval, External send, Publish Report, External Send, External Share |
| generic-stopword | GENERAL_ANSWER | PASS | PASS | No blocking finding | READ_ONLY | read, evidence_review, Copy JSON | external_send, write_back, publish |
