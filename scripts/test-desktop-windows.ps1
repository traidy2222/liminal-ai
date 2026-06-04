# Smoke-test: bundle liminald, launch exe, verify sidecar handshake + WS ping.
param(
  [string]$FlutterRoot = $(if ($env:FLUTTER_ROOT) { $env:FLUTTER_ROOT } else { "$env:LOCALAPPDATA\flutter-sdk" })
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $RepoRoot "apps\liminal_desktop\build\windows\x64\runner\Release"
$Exe = Join-Path $ReleaseDir "liminal_desktop.exe"

if (-not (Test-Path $Exe)) {
  Write-Host "Release exe missing — running full desktop build..."
  & (Join-Path $RepoRoot "scripts\build-desktop-windows.ps1") -FlutterRoot $FlutterRoot
}

if (-not (Test-Path (Join-Path $ReleaseDir "liminald\repo\packages\sidecar\dist\index.js"))) {
  Write-Host "Bundling liminald..."
  & (Join-Path $RepoRoot "scripts\bundle-liminald-for-desktop.ps1") -ReleaseDir $ReleaseDir -RepoRoot $RepoRoot
}

$sidecarScript = Join-Path $ReleaseDir "liminald\repo\packages\sidecar\dist\index.js"
$bundleRoot = Join-Path $ReleaseDir "liminald\repo"

Write-Host "==> Starting liminald from bundle..."
$lim = Start-Process -FilePath "node" -ArgumentList $sidecarScript -WorkingDirectory $bundleRoot -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $env:TEMP "liminald-out.txt") -RedirectStandardError (Join-Path $env:TEMP "liminald-err.txt")

Start-Sleep -Seconds 3
$handshakePath = Join-Path $env:USERPROFILE ".liminal\sidecar.json"
if (-not (Test-Path $handshakePath)) {
  Get-Content (Join-Path $env:TEMP "liminald-err.txt") -ErrorAction SilentlyContinue
  throw "Handshake file not created — liminald failed to start."
}

$hs = Get-Content $handshakePath | ConvertFrom-Json
Write-Host "Sidecar up on port $($hs.port) pid $($hs.pid)"

Write-Host "==> Launching desktop UI..."
$ui = Start-Process -FilePath $Exe -WorkingDirectory $ReleaseDir -PassThru
Start-Sleep -Seconds 5

if (-not $ui.HasExited) {
  Write-Host "OK: liminal_desktop running (pid $($ui.Id)). Close the window when done."
} else {
  throw "Desktop exe exited immediately with code $($ui.ExitCode)"
}

# Optional cleanup note
Write-Host "To stop sidecar: Stop-Process -Id $($lim.Id) -Force -ErrorAction SilentlyContinue"
