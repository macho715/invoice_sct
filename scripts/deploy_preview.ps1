#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
  Preview 환경 동시 deploy: Cloudflare Worker + Vercel.
.DESCRIPTION
  Phase 1: wrangler deploy --env preview
  Phase 2: vercel --target preview
  Phase 3: uvicorn background 시작
  Phase 4: e2e_preview.mjs 실행
#>
param(
  [string]$E2EPath = "scripts/e2e_preview.mjs"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $ProjectRoot

Write-Host "=== Phase 1: wrangler preview deploy ===" -ForegroundColor Cyan
npx wrangler deploy --env preview --outdir dist/preview
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed" }
$WorkerPreview = "https://hvdc-ontology-chatgpt-app-preview.mscho715.workers.dev"

Write-Host "=== Phase 2: vercel preview deploy ===" -ForegroundColor Cyan
$env:VERCEL_ORG_ID = $env:VERCEL_ORG_ID
$env:VERCEL_PROJECT_ID = $env:VERCEL_PROJECT_ID
$env:VERCEL_TOKEN = $env:VERCEL_TOKEN
npx vercel --target preview --no-clipboard
$VercelPreview = npx vercel ls --target preview --token=$env:VERCEL_TOKEN | Select-Object -First 1

Write-Host "=== Phase 3: uvicorn background ===" -ForegroundColor Cyan
Set-Location apps/worker-py
$uvicorn = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" -PassThru -NoNewWindow
Set-Location $ProjectRoot
Start-Sleep -Seconds 5

try {
  Write-Host "=== Phase 4: e2e_preview.mjs ===" -ForegroundColor Cyan
  node $E2EPath --worker $WorkerPreview --vercel $VercelPreview
  if ($LASTEXITCODE -ne 0) { throw "e2e_preview failed" }
  Write-Host "=== Preview deploy + E2E success ===" -ForegroundColor Green
} finally {
  if ($uvicorn -and -not $uvicorn.HasExited) {
    Stop-Process -Id $uvicorn.Id -Force
    Write-Host "uvicorn stopped" -ForegroundColor Yellow
  }
}
