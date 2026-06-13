[CmdletBinding()]
param(
  [string]$BucketName = "hvdc-ontology-files",
  [string]$DatabaseName = "hvdc-mcp-audit",
  [ValidateSet("weur", "eeur", "apac", "oc", "wnam", "enam")]
  [string]$Location = "apac",
  [switch]$SkipVerify,
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Get-CommandPath {
  param([Parameter(Mandatory = $true)][string]$Name)

  return (Get-Command $Name -ErrorAction Stop).Source
}

function Invoke-ToolCapture {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )

  Write-Host (">> {0} {1}" -f (Split-Path -Leaf $FilePath), ($Arguments -join " "))
  $Output = & $FilePath @Arguments 2>&1
  $ExitCode = $LASTEXITCODE
  $Text = ($Output | Out-String).Trim()

  if ($Text.Length -gt 0) {
    Write-Host $Text
  }

  if (($ExitCode -ne 0) -and (-not $AllowFailure)) {
    throw ("Command failed with exit code {0}: {1} {2}" -f $ExitCode, $FilePath, ($Arguments -join " "))
  }

  return [pscustomobject]@{
    ExitCode = $ExitCode
    Text = $Text
  }
}

function Get-D1DatabaseId {
  param(
    [Parameter(Mandatory = $true)][string]$Json,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Json)) {
    return $null
  }

  $Parsed = $Json | ConvertFrom-Json
  if ($null -eq $Parsed) {
    return $null
  }

  if ($Parsed.PSObject.Properties.Name -contains "result") {
    $Databases = @($Parsed.result)
  } else {
    $Databases = @($Parsed)
  }

  $Database = $Databases | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if ($null -eq $Database) {
    return $null
  }

  foreach ($PropertyName in @("database_id", "uuid", "id")) {
    if (($Database.PSObject.Properties.Name -contains $PropertyName) -and (-not [string]::IsNullOrWhiteSpace($Database.$PropertyName))) {
      return [string]$Database.$PropertyName
    }
  }

  return $null
}

function Update-WranglerConfig {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Bucket,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$DatabaseId
  )

  $Config = [System.IO.File]::ReadAllText($Path)
  $Config = [regex]::Replace($Config, 'bucket_name\s*=\s*"[^"]+"', ('bucket_name = "{0}"' -f $Bucket), 1)
  $Config = [regex]::Replace($Config, 'database_name\s*=\s*"[^"]+"', ('database_name = "{0}"' -f $Database), 1)
  $Config = [regex]::Replace($Config, 'database_id\s*=\s*"[^"]+"', ('database_id = "{0}"' -f $DatabaseId), 1)
  [System.IO.File]::WriteAllText($Path, $Config, [System.Text.UTF8Encoding]::new($false))
}

$Npm = Get-CommandPath "npm"
$Npx = Get-CommandPath "npx"
$WranglerToml = Join-Path $RepoRoot "wrangler.toml"
if ([string]::IsNullOrWhiteSpace($env:CI)) {
  $env:CI = "true"
}

$Whoami = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "whoami") -AllowFailure
if ($Whoami.ExitCode -ne 0) {
  throw "Wrangler is not authenticated. Run 'npx wrangler login' or set CLOUDFLARE_API_TOKEN before running this script."
}

if (-not $SkipVerify) {
  Invoke-ToolCapture -FilePath $Npm -Arguments @("run", "verify") | Out-Null
}

$R2List = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "r2", "bucket", "list")
if ($R2List.Text -match [regex]::Escape($BucketName)) {
  Write-Host ("R2 bucket already exists: {0}" -f $BucketName)
} else {
  $R2Create = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "r2", "bucket", "create", $BucketName, "--location", $Location) -AllowFailure
  if (($R2Create.ExitCode -ne 0) -and ($R2Create.Text -notmatch "already exists|exists already")) {
    throw ("R2 bucket creation failed: {0}" -f $BucketName)
  }
}

$D1List = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "d1", "list", "--json")
$DatabaseId = Get-D1DatabaseId -Json $D1List.Text -Name $DatabaseName

if ([string]::IsNullOrWhiteSpace($DatabaseId)) {
  $D1Create = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "d1", "create", $DatabaseName, "--location", $Location)
  $DatabaseIdMatch = [regex]::Match($D1Create.Text, 'database_id\s*=\s*"([^"]+)"')
  if (-not $DatabaseIdMatch.Success) {
    throw "D1 database was created or requested, but database_id could not be parsed from Wrangler output."
  }
  $DatabaseId = $DatabaseIdMatch.Groups[1].Value
}

Update-WranglerConfig -Path $WranglerToml -Bucket $BucketName -Database $DatabaseName -DatabaseId $DatabaseId
Write-Host ("Updated wrangler.toml with D1 database_id: {0}" -f $DatabaseId)

Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "d1", "migrations", "apply", $DatabaseName, "--remote") | Out-Null

if (-not $SkipDeploy) {
  $Deploy = Invoke-ToolCapture -FilePath $Npx -Arguments @("wrangler", "deploy")
  $UrlMatch = [regex]::Match($Deploy.Text, 'https://[^\s]+\.workers\.dev')
  if ($UrlMatch.Success) {
    $WorkerUrl = $UrlMatch.Value.TrimEnd("/")
    Write-Host ("Worker URL: {0}" -f $WorkerUrl)
    Write-Host ("MCP endpoint: {0}/mcp" -f $WorkerUrl)
    Invoke-RestMethod -Method Get -Uri ("{0}/healthz" -f $WorkerUrl) | ConvertTo-Json -Depth 6
  }
}
