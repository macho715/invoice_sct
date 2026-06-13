# Codex Setup

## Use repository guidance

Codex reads `AGENTS.md` from the repository root. Keep root rules short and strict.

## Skills included

```text
.agents/skills/ontology-corpus-indexer/SKILL.md
.agents/skills/mcp-tool-contract/SKILL.md
.agents/skills/answer-grounding/SKILL.md
.agents/skills/validation-gate/SKILL.md
.agents/skills/uiux-component/SKILL.md
.agents/skills/privacy-redactor/SKILL.md
.agents/skills/submission-readiness/SKILL.md
```

## Useful Codex prompts

```text
Use the mcp-tool-contract skill. Review all registered tools for clear names, narrow schemas, and readOnlyHint correctness.
```

```text
Use the answer-grounding skill. Add tests so ask_hvdc_ontology returns NO_EVIDENCE when no EvidenceSnippet exists.
```

```text
Use the privacy-redactor skill. Audit UI, logs, tests, and reports for email/phone leakage.
```
