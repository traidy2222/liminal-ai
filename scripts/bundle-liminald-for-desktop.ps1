# Stage a portable liminald runtime beside the Windows Release folder.
# Output: Release/liminald/repo/ (sidecar + production node_modules) + bundle.json (paths relative to .exe).
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [switch]$CopyNodeModulesFromRepo
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$ReleaseDir = (Resolve-Path $ReleaseDir).Path

$sidecarEntry = Join-Path $RepoRoot "packages\sidecar\dist\index.js"
if (-not (Test-Path $sidecarEntry)) {
  throw "Missing $sidecarEntry. Run: npm run build:sidecar"
}

$BundleRoot = Join-Path $ReleaseDir "liminald"
$BundleRepo = Join-Path $BundleRoot "repo"
$Packages = @("core", "protocol", "tools", "sidecar")

function Initialize-BundleRepo([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path, (Join-Path $Path "packages") | Out-Null
    return
  }
  $removed = $false
  try {
    Remove-Item -Recurse -Force $Path -ErrorAction Stop
    $removed = $true
  } catch {
    $staleName = "repo.stale.$([DateTime]::UtcNow.Ticks)"
    $stalePath = Join-Path (Split-Path $Path -Parent) $staleName
    try {
      Rename-Item -Path $Path -NewName $staleName -Force -ErrorAction Stop
      $removed = $true
      Write-Host "==> Bundle repo locked - staged fresh tree; stale copy at $stalePath"
    } catch {
      Write-Host "==> Bundle repo locked - refreshing packages in place (close liminal_desktop.exe for clean rebundle)"
    }
  }
  if ($removed) {
    New-Item -ItemType Directory -Force -Path $Path, (Join-Path $Path "packages") | Out-Null
  } else {
    New-Item -ItemType Directory -Force -Path $Path, (Join-Path $Path "packages") | Out-Null
  }
}

Initialize-BundleRepo $BundleRepo

Write-Host "==> Staging portable liminald repo -> $BundleRepo"

$runtimePkg = Join-Path $PSScriptRoot "desktop-runtime.package.json"
Copy-Item $runtimePkg (Join-Path $BundleRepo "package.json") -Force

foreach ($name in $Packages) {
  $srcPkg = Join-Path $RepoRoot "packages\$name"
  $destPkg = Join-Path $BundleRepo "packages\$name"
  if (-not (Test-Path (Join-Path $srcPkg "dist\index.js"))) {
    throw "Missing packages/$name/dist - run: npm run build:sidecar"
  }
  New-Item -ItemType Directory -Force $destPkg | Out-Null
  Copy-Item (Join-Path $srcPkg "package.json") $destPkg -Force
  Copy-Item (Join-Path $srcPkg "dist") $destPkg -Recurse -Force
}

$hostedConnect = Join-Path $BundleRepo "packages\core\dist\hosted_oauth_connect.js"
if (-not (Test-Path $hostedConnect)) {
  throw "Bundle incomplete: packages/core/dist/hosted_oauth_connect.js missing"
}
$hostedConnectSrc = Get-Content $hostedConnect -Raw
if ($hostedConnectSrc -notmatch "runHostedIntegrationConnectFlow") {
  throw "Stale core bundle: missing hosted integration OAuth. Close liminal_desktop.exe and rebundle."
}
$googleHosted = Join-Path $BundleRepo "packages\core\dist\google_hosted_connect.js"
if (-not (Test-Path $googleHosted)) {
  throw "Bundle incomplete: packages/core/dist/google_hosted_connect.js missing"
}

$license = Join-Path $RepoRoot "LICENSE"
if (Test-Path $license) {
  Copy-Item $license (Join-Path $BundleRepo "LICENSE") -Force
}

$envExample = Join-Path $RepoRoot ".env.example"
if (Test-Path $envExample) {
  Copy-Item $envExample (Join-Path $BundleRepo ".env.example") -Force
}

$envSrc = Join-Path $RepoRoot ".env"
if (Test-Path $envSrc) {
  Copy-Item $envSrc (Join-Path $BundleRepo ".env") -Force
  Write-Host "==> Copied .env into bundle (OAuth decrypt + API key for desktop)"
} else {
  Write-Host "==> No .env in repo root - desktop OAuth needs liminald/repo/.env or ~/.liminal/.env"
}

$readme = @"
Liminal Desktop — bundled harness runtime (do not edit unless you know what you are doing).

First run:
  1. Install Node.js 20+ (https://nodejs.org/) and ensure ``node`` is on PATH.
  2. Copy ``.env.example`` to ``.env`` in this folder and set ``AGENT_API_KEY``.
  3. Run ``liminal_desktop.exe`` from the parent Release folder (not this directory).

Pro users can sign in inside the app instead of using a local API key.
"@
Set-Content -Path (Join-Path $BundleRepo "README.txt") -Value $readme -Encoding utf8

$srcModules = Join-Path $RepoRoot "node_modules"
if ($CopyNodeModulesFromRepo -and (Test-Path $srcModules)) {
  Write-Host "==> Copying node_modules from monorepo (fast path)..."
  $destModules = Join-Path $BundleRepo "node_modules"
  New-Item -ItemType Directory -Force $destModules | Out-Null
  & robocopy $srcModules $destModules /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  $robocopyExit = $LASTEXITCODE
  if ($robocopyExit -ge 8) {
    throw "robocopy node_modules failed with exit $robocopyExit"
  }
  # Robocopy uses 0-7 for success; do not propagate to callers (npm/CI treat non-zero as failure).
  $global:LASTEXITCODE = 0
} else {
  Write-Host "==> npm install --omit=dev (portable runtime, may take a few minutes)..."
  Push-Location $BundleRepo
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Pop-Location
}

if (-not (Test-Path (Join-Path $BundleRepo "packages\sidecar\dist\index.js"))) {
  throw "Bundle incomplete: sidecar dist missing after install"
}

$pwBrowsers = Join-Path $BundleRoot "playwright-browsers"
New-Item -ItemType Directory -Force $pwBrowsers | Out-Null
Write-Host "==> Installing Playwright Chromium for bundled browser tools..."
Push-Location $BundleRepo
$env:PLAYWRIGHT_BROWSERS_PATH = $pwBrowsers
npx playwright install chromium
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> WARNING: playwright install chromium failed - browser dock may stay empty until browsers are installed."
  $global:LASTEXITCODE = 0
}
Pop-Location
Remove-Item Env:PLAYWRIGHT_BROWSERS_PATH -ErrorAction SilentlyContinue

$scriptRel = "liminald\repo\packages\sidecar\dist\index.js"
$rootRel = "liminald\repo"
$manifest = @{
  layout        = "portable-v1"
  repoRoot      = $rootRel
  sidecarScript = $scriptRel
  builtAt       = (Get-Date).ToUniversalTime().ToString("o")
  liminalVersion = (Get-Content (Join-Path $RepoRoot "changelog\releases.json") -Raw | ConvertFrom-Json).currentVersion
}
New-Item -ItemType Directory -Force $BundleRoot | Out-Null
$manifest | ConvertTo-Json | Set-Content (Join-Path $BundleRoot "bundle.json") -Encoding utf8

Write-Host "==> bundle.json (paths relative to Release/)"
Write-Host "    repoRoot:      $rootRel"
Write-Host "    sidecarScript: $scriptRel"

& (Join-Path $RepoRoot "scripts\copy-desktop-updater.ps1") $BundleRoot
exit 0
