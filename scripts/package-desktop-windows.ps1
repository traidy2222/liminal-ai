# Build + zip Liminal Desktop for GitHub Releases.
# Usage (repo root):
#   .\scripts\package-desktop-windows.ps1
#   .\scripts\package-desktop-windows.ps1 -Version 0.0.18
param(
  [string]$Version = "",
  [string]$FlutterRoot = $(if ($env:FLUTTER_ROOT) { $env:FLUTTER_ROOT } else { "$env:LOCALAPPDATA\flutter-sdk" }),
  [switch]$SkipBuild,
  [switch]$CopyNodeModulesFromRepo
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $Version) {
  $releasesPath = Join-Path $RepoRoot "changelog\releases.json"
  if (Test-Path $releasesPath) {
    $Version = (Get-Content $releasesPath -Raw | ConvertFrom-Json).currentVersion
  }
  if (-not $Version) { $Version = "0.0.0" }
}

if (-not $SkipBuild) {
  $buildArgs = @{ FlutterRoot = $FlutterRoot }
  if ($CopyNodeModulesFromRepo) { $buildArgs.CopyNodeModulesFromRepo = $true }
  & (Join-Path $RepoRoot "scripts\build-desktop-windows.ps1") @buildArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  $releaseDir = Join-Path $RepoRoot "apps\liminal_desktop\build\windows\x64\runner\Release"
  if (-not (Test-Path (Join-Path $releaseDir "liminal_desktop.exe"))) {
    throw "Release build missing. Run without -SkipBuild first."
  }
  $bundleArgs = @{
    ReleaseDir = $releaseDir
    RepoRoot   = $RepoRoot
  }
  if ($CopyNodeModulesFromRepo) { $bundleArgs["CopyNodeModulesFromRepo"] = $true }
  & (Join-Path $RepoRoot "scripts\bundle-liminald-for-desktop.ps1") @bundleArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$ReleaseDir = Join-Path $RepoRoot "apps\liminal_desktop\build\windows\x64\runner\Release"
$DistDir = Join-Path $RepoRoot "dist"
New-Item -ItemType Directory -Force $DistDir | Out-Null

$zipName = "liminal-desktop-windows-x64-v$Version.zip"
$zipPath = Join-Path $DistDir $zipName
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

$releaseNotes = @"
Liminal Desktop $Version (Windows x64 alpha)

Requirements:
- Windows 10/11 x64
- Node.js 20+ on PATH (https://nodejs.org/)
- API key: copy liminald\repo\.env.example to liminald\repo\.env and set AGENT_API_KEY,
  or sign in with Vireon inside the app (Pro managed inference).

Install:
1. Unzip this archive anywhere.
2. Run liminal_desktop.exe from the extracted folder (do not move the .exe alone).
3. Keep the liminald\ folder next to the .exe.

License: FSL-1.1-MIT — https://github.com/traidy2222/liminal-ai/blob/main/LICENSE
"@
Set-Content -Path (Join-Path $ReleaseDir "README.txt") -Value $releaseNotes -Encoding utf8

Write-Host "==> Creating $zipName ..."
Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

$hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$hashPath = "$zipPath.sha256"
Set-Content -Path $hashPath -Value "$hash  $zipName" -Encoding ascii -NoNewline

Write-Host ""
Write-Host "Package ready."
Write-Host "  Zip:    $zipPath"
Write-Host "  SHA256: $hash"
Write-Host "  Hash:   $hashPath"
Write-Host ""
Write-Host "GitHub release:"
Write-Host "  git tag v$Version-desktop"
Write-Host "  git push origin v$Version-desktop"
Write-Host "  gh release create v$Version-desktop `"$zipPath`" --title `"Liminal Desktop $Version (Windows)`""
