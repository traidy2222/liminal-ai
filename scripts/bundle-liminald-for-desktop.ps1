# Stage liminald metadata beside the Windows Release exe.
# The sidecar runs from the monorepo (packages/sidecar/dist) so Node resolves
# workspace deps from the repo root node_modules.
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [Parameter(Mandatory = $true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$ReleaseDir = (Resolve-Path $ReleaseDir).Path

$sidecarEntry = Join-Path $RepoRoot "packages\sidecar\dist\index.js"
if (-not (Test-Path $sidecarEntry)) {
  throw "Missing $sidecarEntry. Run: npm run build:sidecar"
}

$LiminaldMeta = Join-Path $ReleaseDir "liminald"
New-Item -ItemType Directory -Force $LiminaldMeta | Out-Null

$manifest = @{
  repoRoot      = $RepoRoot
  sidecarScript = $sidecarEntry
  builtAt       = (Get-Date).ToUniversalTime().ToString("o")
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $LiminaldMeta "bundle.json") -Encoding utf8

Write-Host "==> liminald manifest -> $sidecarEntry"
Write-Host "    (requires repo node_modules; run npm install at repo root if needed)"
