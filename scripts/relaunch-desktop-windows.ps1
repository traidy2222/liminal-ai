param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][string]$ExeDir,
  [Parameter(Mandatory = $true)][string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$UpdaterDir = Join-Path $ExeDir "liminald\updater"
$ApplyScript = Join-Path $UpdaterDir "apply-desktop-update.mjs"

function Wait-ForProcess([int]$Pid, [int]$TimeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $Pid -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

Write-Host "Waiting for Liminal Desktop (PID $ParentPid) to exit..."
if (-not (Wait-ForProcess $ParentPid)) {
  Write-Error "Timed out waiting for parent process"
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js is required on PATH to apply app updates"
  exit 1
}

& $node.Source $ApplyScript `
  --mode app `
  --exe-dir $ExeDir `
  --archive $ArchivePath `
  --platform windows `
  --relaunch-pid 0

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$pending = Join-Path $ExeDir "pending_update.json"
if (Test-Path $pending) { Remove-Item -Force $pending }
Write-Host "App update applied."
