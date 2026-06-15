# Copy updater scripts into liminald/updater/ beside a desktop release bundle.
param(
  [Parameter(Mandatory = $true)][string]$LiminaldRoot
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $LiminaldRoot "updater"
New-Item -ItemType Directory -Force $Dest | Out-Null

Copy-Item (Join-Path $RepoRoot "scripts\apply-desktop-update.mjs") $Dest -Force
Copy-Item (Join-Path $RepoRoot "scripts\lib\update-release.mjs") $Dest -Force
Copy-Item (Join-Path $RepoRoot "scripts\lib\desktop-release-names.mjs") $Dest -Force
Copy-Item (Join-Path $RepoRoot "scripts\lib\apply-app-swap.mjs") $Dest -Force
Copy-Item (Join-Path $RepoRoot "scripts\relaunch-desktop.sh") $Dest -Force
Copy-Item (Join-Path $RepoRoot "scripts\relaunch-desktop-windows.ps1") $Dest -Force

Write-Host "==> Copied desktop updater -> $Dest"
exit 0
