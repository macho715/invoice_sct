#!/usr/bin/env bash
# Deploy the invoice-audit parser worker (apps/worker-py) to Google Cloud Run.
# Replaces the Fly.io deployment (hvdc-invoice-parser).
#
# The existing Dockerfile listens on 8000 (uvicorn --port 8000), so we pass
# --port 8000 and Cloud Run routes traffic there. No Dockerfile change needed.
#
# Prereqs: gcloud + auth + project + billing; APIs: run, cloudbuild,
# artifactregistry (+ vision, storage if VISION_ENABLED). Run from apps/worker-py.
# Full procedure: docs/20260615_cloud-run-migration-runbook.md
#
# Usage:
#   GCP_PROJECT=my-proj GCP_REGION=asia-northeast3 ./deploy-cloudrun.sh
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
GCP_REGION="${GCP_REGION:-asia-northeast3}"
SERVICE="${SERVICE:-hvdc-invoice-parser}"

# NOTE: secrets/URLs are NOT set here. After this deploy, attach them with
# Secret Manager (preferred) or `gcloud run services update --set-env-vars=...`:
#   MARKITDOWN_MCP_URL, NOTEBOOKLM_MCP_URL, WEB_CALLBACK_URL,
#   NOTEBOOKLM_CALLBACK_SECRET, PARSER_WORKER_TOKEN,
#   (Vision path) VISION_ENABLED, GOOGLE_CLOUD_PROJECT, GCS bucket var.
# On Cloud Run, Vision/GCS auth uses the service's attached service account
# (Application Default Credentials) — no GOOGLE_APPLICATION_CREDENTIALS key file.
gcloud run deploy "${SERVICE}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --source . \
  --port 8000 \
  --no-allow-unauthenticated \
  --min-instances 0 \
  --max-instances 5 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 600   # 10 min — accommodates the NotebookLM orchestrator (~300s)

echo
echo "Deployed. Service URL:"
gcloud run services describe "${SERVICE}" \
  --project "${GCP_PROJECT}" --region "${GCP_REGION}" \
  --format 'value(status.url)'
echo "→ Set Vercel PARSER_WORKER_URL to this URL, AND patch the run-route host"
echo "  allowlist to include '.run.app' (runbook §6) or Vercel will reject it."
