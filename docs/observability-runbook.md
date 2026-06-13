# Observability Runbook — HVDC Ontology MCP

## Secret Setup

AXIOM_DATASET is already set in wrangler.toml. Only the token is a secret:

```bash
wrangler secret put AXIOM_TOKEN
# Paste your Axiom API token at the prompt.
# Generate it at: Axiom dashboard → Settings → API Tokens → New Token (ingest scope)
```

Verify the secret is registered:

```bash
wrangler secret list
# Should show: AXIOM_TOKEN
```

To confirm spans are arriving after deployment, query Axiom within 5 minutes of the first tool call.

## Axiom APL Queries

### BLOCK verdict count (last 1 hour)

```apl
['hvdc-mcp-prod']
| where ['attributes.hvdc.verdict'] == "BLOCK"
| summarize count() by bin(_time, 5m)
```

### p95 latency for ask_hvdc_ontology

```apl
['hvdc-mcp-prod']
| where ['attributes.mcp.tool.name'] == "ask_hvdc_ontology"
| summarize percentile(duration, 95) by bin(_time, 5m)
```

### 429 rate by tier

```apl
['hvdc-mcp-prod']
| where ['attributes.http.status_code'] == 429
| summarize count() by ['attributes.rate_limit_tier'], bin(_time, 5m)
```

### validation_status breakdown

```apl
['hvdc-mcp-prod']
| summarize count() by ['attributes.hvdc.validation_status'], bin(_time, 1h)
```

## Alert Thresholds

| Alert | Condition | Action |
|---|---|---|
| BLOCK spike | BLOCK verdicts > 5% of total calls in 15 min | Investigate prompt pattern; check AGI/DAS cargo data |
| p95 latency high | ask_hvdc_ontology p95 > 500 ms over 5 min | Check D1 KV cache hit rate; restart if needed |
| 429 surge (normal users) | 429 rate > 0.1% of calls in 5 min | Check for retry loops from ChatGPT plugin; review per-token tier |
| Span gap | No spans for 10+ min during business hours | Verify AXIOM_TOKEN secret; check OTEL_ENABLED wrangler var |

## Operational Checklist

### Verify spans are arriving after deployment

1. Deploy: `npm run worker:deploy`
2. Call any MCP tool once (e.g., `ask_hvdc_ontology` with any question)
3. Open Axiom → dataset `hvdc-mcp-prod` → last 5 minutes
4. Confirm at least one span with `attributes.mcp.tool.name` is visible

### Re-enable OTEL if disabled

If `OTEL_ENABLED` was set to `false` in wrangler.toml:

```toml
# wrangler.toml
OTEL_ENABLED = "true"
```

Then redeploy: `npm run worker:deploy`

### Interpret hvdc.validation_status values

| Value | Meaning |
|---|---|
| `PASS` | All evidence checks passed, no missing documents |
| `PASS_WITH_FINDINGS` | Passed but minor findings (rate mismatch < 5%) |
| `WARN` | Non-blocking issues (missing MOSB chain evidence requiring backfill) |
| `BLOCK` | Blocking issue: missing SITE_RECEIPT, invoice > 100,000 AED, or no M130 evidence |
| `NO_EVIDENCE` | No corpus evidence found; shipment rule result is secondary only |
| `INFO` | Informational only; no matching shipment or validation criteria |

### Interpret hvdc.verdict values

| Value | Meaning |
|---|---|
| `PASS` | Grounded answer, all gates passed |
| `AMBER` | Partial evidence; requires caution |
| `WARN` | Non-critical issue; backfill or review needed |
| `BLOCK` | Hard stop; human gate required before proceeding |
| `NO_EVIDENCE` | No corpus evidence; answer cannot be grounded |
| `INFO` | General information, no validation applied |

## wrangler.toml Reference

```toml
OTEL_ENABLED = "true"
AXIOM_DATASET = "hvdc-mcp-prod"
# AXIOM_TOKEN is set via: wrangler secret put AXIOM_TOKEN
```
