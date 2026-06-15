#!/usr/bin/env bash
# Deploy the MarkItDown MCP server to Google Cloud Run (from this dir's Dockerfile).
#
# Prereqs: gcloud installed + `gcloud auth login` + project set + billing enabled,
# and these APIs enabled: run, cloudbuild, artifactregistry.
# See docs/20260615_cloud-run-migration-runbook.md for the full procedure.
#
# Usage:
#   GCP_PROJECT=my-proj GCP_REGION=asia-northeast3 ./deploy.sh
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
GCP_REGION="${GCP_REGION:-asia-northeast3}"
SERVICE="${SERVICE:-markitdown-mcp}"

# --no-allow-unauthenticated: only IAM-authorized callers (the worker) may invoke.
#   The worker client must then attach a Cloud Run ID token (see runbook §3).
#   For a throwaway bring-up smoke you may temporarily swap to
#   --allow-unauthenticated, but DO NOT leave it public in prod.
# --min-instances 1 + --session-affinity: keep the MCP session (initialize→call)
#   pinned to one warm instance so streamable-HTTP session ids resolve.
gcloud run deploy "${SERVICE}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --source . \
  --port 8080 \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --max-instances 3 \
  --session-affinity \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300

echo
echo "Deployed. Service URL:"
gcloud run services describe "${SERVICE}" \
  --project "${GCP_PROJECT}" --region "${GCP_REGION}" \
  --format 'value(status.url)'
echo "→ Set the worker's MARKITDOWN_MCP_URL to  <URL>/mcp  (verify the exact MCP path; see runbook §6)."
