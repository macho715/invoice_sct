#!/usr/bin/env bash
# Deploy the standalone MCP server (apps/mcp-server) to Google Cloud Run.
# Replaces the former Fly.io deployment (hvdc-mcp-server).
#
# This server is for EXTERNAL clients (ChatGPT, Claude Desktop) via JSON-RPC; it
# is NOT called during the web audit flow. Deploy only if external MCP access is
# needed. The existing Dockerfile listens on 3000 (ENV PORT=3000), so we pass
# --port 3000; Cloud Run routes traffic there. No Dockerfile change needed.
#
# Prereqs: gcloud + auth + project + billing; APIs: run, cloudbuild,
# artifactregistry. Run from apps/mcp-server.
# Full procedure: docs/20260615_cloud-run-migration-runbook.md
#
# Usage:
#   GCP_PROJECT=my-proj GCP_REGION=asia-northeast3 ./deploy-cloudrun.sh
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
GCP_REGION="${GCP_REGION:-asia-northeast3}"
SERVICE="${SERVICE:-hvdc-mcp-server}"

# Secrets/env (DATABASE_URL, API_SECRET_KEY, etc.) are NOT set here — attach with
# Secret Manager or `gcloud run services update --set-env-vars=...` after deploy.
gcloud run deploy "${SERVICE}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --source . \
  --port 3000 \
  --no-allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 120

echo
echo "Deployed. Service URL:"
gcloud run services describe "${SERVICE}" \
  --project "${GCP_PROJECT}" --region "${GCP_REGION}" \
  --format 'value(status.url)'
