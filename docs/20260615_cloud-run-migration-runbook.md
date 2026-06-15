# Cloud Run Migration Runbook — worker + MarkItDown MCP

> 2026-06-15 · Move `apps/worker-py` and a new `apps/markitdown-mcp` off Fly.io
> onto Google Cloud Run. **This doc is the plan/runbook only — no resources are
> created by reading it.**
>
> **⛔ HARD BLOCKER (2026-06-15): billing is NOT enabled on project `dsv-invoice`**
> (`gcloud billing projects describe dsv-invoice` → `billingEnabled: False`). Cloud
> Run deploy, Cloud Build, Artifact Registry, and GCS bucket creation all require
> billing. This is the **same blocker** that stopped the Google Vision GCS smoke
> (see `20260615_google_vision_gcp_auth_worklog.md` §10). Connect a billing account
> first; then Vision OCR and Cloud Run unblock together.

## 0. Current state (verified 2026-06-15)

| Layer | State | Evidence |
|---|---|---|
| Vercel web | Up (`sct-ontology-invoice-audit.vercel.app`) | `vercel env ls` returns prod vars |
| MarkItDown → NotebookLM trigger | **OFF** | `NOTEBOOKLM_ENABLED` absent in Vercel prod env; `run/route.ts:113` gate never fires |
| Worker (Fly `hvdc-invoice-parser`) | **Down** | Fly trial ended (`trial has ended`) |
| Worker code wiring | OK | `mcp>=1.2` dep present; `MarkItDownMcpClient` → `convert_to_markdown` |

So MarkItDown MCP is **wired but never invoked in prod**. Goal: host worker +
MarkItDown MCP on Cloud Run, then (separately) flip the flag on.

## 1. Target architecture

```
apps/web (Vercel)
  └─ PARSER_WORKER_URL ─▶ worker (Cloud Run, hvdc-invoice-parser, :8000)
                              ├─ MARKITDOWN_MCP_URL ─▶ markitdown-mcp (Cloud Run, :8080)  [stateless]
                              └─ NOTEBOOKLM_MCP_URL ─▶ NotebookLM MCP (NOT Cloud Run — persistent browser host; out of scope here)
```

- **markitdown-mcp** → Cloud Run, scale-to-zero OK (stateless).
- **worker** → Cloud Run, `--timeout 600` for the NotebookLM orchestrator (~300s).
- **NotebookLM MCP** → needs a persistent browser + Google cookies → host on an
  always-on VM (GCE e2-micro / small VPS) later. Not covered by this runbook.

## 2. Prerequisites — current state (2026-06-15)

Already done (per the Vision auth worklog + live check):

| Item | State |
|---|---|
| gcloud SDK | ✅ Installed v572.0.0 — **not on PATH**. Path: `C:\Users\jichu\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd` |
| Auth | ✅ `mscho715@gmail.com`, ADC + CLI login done |
| Project | ✅ `dsv-invoice` (set as default) |
| Service account | ✅ `svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com` (storage object viewer/creator) — reuse as the worker/markitdown runtime SA |
| Vision/IAM/CRM APIs | ✅ enabled |
| **Billing** | ⛔ **NOT enabled** — blocks everything below |
| Cloud Run APIs | ❌ `run` / `cloudbuild` / `artifactregistry` **not enabled yet** (verified: none present) |

Remaining (after billing is connected):

```bash
# Add gcloud to PATH for this shell (or use the full path above):
export PATH="$PATH:/c/Users/jichu/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin"

# Enable Cloud Run build/deploy APIs (needs billing):
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --project dsv-invoice

export GCP_PROJECT=dsv-invoice
export GCP_REGION=asia-northeast3   # Seoul — matches the GCS bucket region in the worklog
```

> The `deploy.sh` / `deploy-cloudrun.sh` scripts call `gcloud` on PATH — either add
> it to PATH (above) or set an alias to the full `gcloud.cmd`.

## 3. Deploy MarkItDown MCP

```bash
cd apps/markitdown-mcp
GCP_PROJECT=$GCP_PROJECT GCP_REGION=$GCP_REGION ./deploy.sh
```

Cloud Run specifics already baked into the Dockerfile / deploy.sh:

| Requirement | Handled by |
|---|---|
| bind `0.0.0.0:$PORT` (markitdown defaults to localhost) | Dockerfile `CMD ... --host 0.0.0.0 --port ${PORT}` |
| session affinity for `initialize()`→`call_tool()` | `--session-affinity --min-instances 1` |
| no public exposure | `--no-allow-unauthenticated` |
| large PDF inline (base64) ≤ ~24 MB raw | inherent HTTP/1 ~32 MB cap — note for scanned PDFs |

### Auth between worker → markitdown (pick one)

1. **Recommended (IAM ID token).** Keep `--no-allow-unauthenticated`. Grant the
   worker's service account `roles/run.invoker` on the markitdown service, then
   set **`MARKITDOWN_MCP_USE_ID_TOKEN=true`** on the worker. ✅ Implemented
   (2026-06-15): `MarkItDownMcpClient` now mints a Cloud Run ID token (audience =
   the markitdown service origin) via `google.auth` / the metadata server and
   attaches `Authorization: Bearer <id-token>` — see
   `apps/worker-py/app/notebooklm/mcp_client.py` (`_fetch_id_token`, `_auth_headers`).
   With the flag off (default) the client behaves exactly as before.
2. **Network-restricted.** `--ingress internal` + Direct VPC egress so only
   same-project traffic reaches it. Still needs IAM for `run.app`.
3. **Throwaway smoke only.** `--allow-unauthenticated` temporarily to validate
   conversion, then lock down. Do **not** leave public in prod (DoS/cost).

```bash
# Option 1 IAM grant (worker SA → invoke markitdown):
gcloud run services add-iam-policy-binding markitdown-mcp \
  --region $GCP_REGION \
  --member "serviceAccount:<worker-sa>@$GCP_PROJECT.iam.gserviceaccount.com" \
  --role roles/run.invoker
```

## 4. Deploy worker

```bash
cd apps/worker-py
GCP_PROJECT=$GCP_PROJECT GCP_REGION=$GCP_REGION ./deploy-cloudrun.sh
```

Then attach env/secrets (NOT in the script — no secrets in VCS). Prefer Secret
Manager; quick form:

```bash
gcloud run services update hvdc-invoice-parser --region $GCP_REGION \
  --set-env-vars MARKITDOWN_MCP_URL=https://<markitdown-url>/mcp \
  --set-env-vars NOTEBOOKLM_MCP_URL=<notebooklm-mcp-url> \
  --set-env-vars WEB_CALLBACK_URL=https://sct-ontology-invoice-audit.vercel.app/api/notebooklm/ingest-summary
# Secrets via Secret Manager:
gcloud run services update hvdc-invoice-parser --region $GCP_REGION \
  --set-secrets NOTEBOOKLM_CALLBACK_SECRET=notebooklm-callback-secret:latest \
  --set-secrets PARSER_WORKER_TOKEN=parser-worker-token:latest
```

| Worker env var | Needed for |
|---|---|
| `PARSER_WORKER_TOKEN` | Bearer the web app sends; worker validates |
| `MARKITDOWN_MCP_URL` | MarkItDown MCP endpoint (`.../mcp`) |
| `NOTEBOOKLM_MCP_URL` | NotebookLM MCP endpoint (when that host exists) |
| `WEB_CALLBACK_URL` | Worker → web HMAC callback target |
| `NOTEBOOKLM_CALLBACK_SECRET` | HMAC signing secret (Secret Manager) |
| `MARKITDOWN_MCP_USE_ID_TOKEN` | `true` → worker attaches a Cloud Run ID token when calling the IAM-protected markitdown service (see §3 option 1) |
| `VISION_ENABLED`, `GOOGLE_CLOUD_PROJECT`, GCS bucket | Vision path (optional) |

**Vision/GCS auth on Cloud Run:** use the service's attached service account
(Application Default Credentials) — no `GOOGLE_APPLICATION_CREDENTIALS` key file.
Grant that SA `roles/storage.objectAdmin` (bucket) and Vision access as needed.

## 5. Rewire Vercel → Cloud Run worker

```bash
vercel env rm PARSER_WORKER_URL production
echo "https://<worker-cloud-run-url>" | vercel env add PARSER_WORKER_URL production
```

### ⚠️ Required code patch — host allowlist (blocker)

`apps/web/src/app/api/invoice-audit/run/route.ts:73` only allows:

```ts
const allowedHosts = ['127.0.0.1', 'localhost', '.fly.dev', '.internal', '.vercel.app'];
```

Cloud Run URLs are `*.run.app`, so the run route will **reject** the new worker
with `STORAGE_AUTH_FAILED` until you add `.run.app`:

```diff
- const allowedHosts = ['127.0.0.1', 'localhost', '.fly.dev', '.internal', '.vercel.app'];
+ const allowedHosts = ['127.0.0.1', 'localhost', '.fly.dev', '.run.app', '.internal', '.vercel.app'];
```

✅ **Applied (2026-06-15)** — `.run.app` added to the allowlist; verified by
`pnpm --dir apps/web test` (167 passed, incl. a new `.run.app`-accepted test).

## 6. Verify the MCP endpoint path

`MARKITDOWN_MCP_URL` must point at the exact Streamable HTTP path (commonly
`/mcp`). Confirm from the server, not from assumption:

```bash
# tail logs after deploy, or run locally:
docker run --rm -p 8080:8080 markitdown-mcp   # observe the mounted path on startup
```

## 7. Smoke tests

**(a) MarkItDown MCP standalone** — the orchestrator needs *both* MCP URLs, so to
isolate MarkItDown, test the MCP server directly with a tiny client (or the
worker's `MarkItDownMcpClient`) against a 1-page PDF; expect markdown text back.

**(b) Worker parse/export** (does not need the flag):

```bash
TOKEN=<PARSER_WORKER_TOKEN>
curl -sS -X POST https://<worker-url>/v1/parse \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{ ... parse payload ... }'
curl -sS https://<worker-url>/health/ready
```

**(c) Full chain** — only after the NotebookLM MCP host exists: set
`NOTEBOOKLM_ENABLED=true` in Vercel, run an audit, confirm a `NOTEBOOKLM` trace
step and a callback to `/api/notebooklm/ingest-summary`.

## 8. Rollback

- Cloud Run keeps revisions: `gcloud run services update-traffic <svc> --to-revisions <prev>=100`.
- Vercel: restore the previous `PARSER_WORKER_URL`; revert the allowlist patch.
- The Fly worker can be re-enabled (re-add billing) as a fallback if needed.

## 9. Cost notes

- markitdown-mcp: `--min-instances 1` keeps one warm instance (session affinity)
  → small always-on cost. Drop to 0 if occasional cold start is acceptable and
  you make the client tolerate session re-init.
- worker: `--min-instances 0` (scale to zero) — pay per request; cold start a few
  seconds (heavy Python deps).

## 10. Out of scope (follow-ups)

- NotebookLM MCP persistent-browser host (VM + cookie volume).
- PDF real line extraction (Phase 2.5) to promote PDF-only beyond AMBER.

## Done (billing-independent prerequisites, 2026-06-15)

- ✅ `.run.app` host allowlist patch (`run/route.ts`) + test → web 167 passed.
- ✅ ID-token injection (`mcp_client.py`, flag `MARKITDOWN_MCP_USE_ID_TOKEN`) +
  3 tests → worker 162 passed.
- ✅ Deploy artifacts: `apps/markitdown-mcp/{Dockerfile,deploy.sh,README.md}`,
  `apps/worker-py/deploy-cloudrun.sh`.
