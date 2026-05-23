# Liminal one-command installer (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/traidy2222/liminal-ai/main/scripts/install.ps1 | iex
#Requires -Version 5.1

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:LIMINAL_REPO_URL) { $env:LIMINAL_REPO_URL } else { "https://github.com/traidy2222/liminal-ai.git" }
$Branch = if ($env:LIMINAL_BRANCH) { $env:LIMINAL_BRANCH } else { "main" }

if ($env:LIMINAL_INSTALL_DIR) {
    $InstallDir = (Resolve-Path -LiteralPath $env:LIMINAL_INSTALL_DIR -ErrorAction SilentlyContinue).Path
    if (-not $InstallDir) { $InstallDir = $env:LIMINAL_INSTALL_DIR }
} elseif ($env:LIMINAL_HOME) {
    $InstallDir = Join-Path $env:LIMINAL_HOME "liminal-ai"
} else {
    $LocalApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
    $InstallDir = Join-Path $LocalApp "liminal\liminal-ai"
}

$BinDir = if ($env:LIMINAL_BIN_DIR) { $env:LIMINAL_BIN_DIR } else {
    $LocalApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
    Join-Path $LocalApp "liminal\bin"
}
$ShimPath = Join-Path $BinDir "liminal.cmd"

function Write-Info($msg) { Write-Host "==> $msg" }
function Write-Warn($msg) { Write-Warning $msg }

function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $name"
    }
}

Require-Command git
Require-Command node
Require-Command npm

$nodeVersion = (& node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
    throw "Node.js 22+ required (found v$nodeVersion). Install from https://nodejs.org/"
}

Write-Info "Install directory: $InstallDir"
$InstallParent = Split-Path -Parent $InstallDir
if (-not (Test-Path $InstallParent)) {
    New-Item -ItemType Directory -Force -Path $InstallParent | Out-Null
}

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Info "Updating existing install…"
    Push-Location $InstallDir
    try {
        git fetch origin $Branch --quiet
        git checkout $Branch --quiet 2>$null
        git pull --ff-only origin $Branch
    } catch {
        Write-Warn "git pull failed; continuing with existing tree"
    } finally {
        Pop-Location
    }
} elseif (Test-Path $InstallDir) {
    throw "$InstallDir exists but is not a git repo. Remove it or set LIMINAL_INSTALL_DIR."
} else {
    Write-Info "Cloning $RepoUrl…"
    git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
}

Write-Info "Installing npm dependencies…"
Push-Location $InstallDir
try {
    npm install
} finally {
    Pop-Location
}

Write-Info "Installing liminal CLI shim…"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
}
@(
    "@echo off",
    "node `"$InstallDir\scripts\liminal.mjs`" %*"
) | Set-Content -Path $ShimPath -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    try {
        [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
        $env:Path = "$BinDir;$env:Path"
        Write-Info "Added $BinDir to user PATH (open a new terminal if `liminal` is not found)"
    } catch {
        Write-Warn "Could not update user PATH. Add manually: $BinDir"
    }
} else {
    $env:Path = "$BinDir;$env:Path"
}

$setupArgs = @("setup", "--skip-if-configured")
if ($env:AGENT_API_KEY) {
    $setupArgs += "--non-interactive"
}

Write-Info "Running setup wizard…"
& node (Join-Path $InstallDir "scripts\liminal.mjs") @setupArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Info "Running doctor…"
& node (Join-Path $InstallDir "scripts\liminal.mjs") doctor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($env:LIMINAL_SKIP_LAUNCH -eq "1") {
    Write-Info "LIMINAL_SKIP_LAUNCH=1 — skipping web launch."
    Write-Info "Start manually: liminal web --bootstrap --open"
    exit 0
}

Write-Info "Starting web UI (persona bootstrap)…"
& node (Join-Path $InstallDir "scripts\liminal.mjs") web --bootstrap --open
exit $LASTEXITCODE
