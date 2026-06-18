# Build Liminal Desktop for Windows (Release .exe + bundled data folder).
# Requires: Node 20+, Git, Visual Studio 2022 with "Desktop development with C++", Flutter 3.22+.
#
# Usage (from repo root):
#   .\scripts\build-desktop-windows.ps1
#   .\scripts\build-desktop-windows.ps1 -FlutterRoot "C:\src\flutter"

param(
  [string]$FlutterRoot = $(if ($env:FLUTTER_ROOT) { $env:FLUTTER_ROOT } else { "$env:LOCALAPPDATA\flutter-sdk" }),
  [switch]$CopyNodeModulesFromRepo
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $RepoRoot "apps\liminal_desktop"

function Get-FlutterExe {
  $candidates = @(
    (Get-Command flutter -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    (Join-Path $FlutterRoot "bin\flutter.bat"),
    "$env:LOCALAPPDATA\flutter\bin\flutter.bat",
    "$env:USERPROFILE\flutter\bin\flutter.bat",
    "C:\flutter\bin\flutter.bat"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $candidates) {
    throw "Flutter not found. Install from https://docs.flutter.dev/get-started/install/windows or set -FlutterRoot."
  }
  # Force array so a single path is not indexed as a string (char 0 => "C").
  @($candidates)[0]
}

Write-Host "==> Building liminald sidecar..."
Push-Location $RepoRoot
npm run build:sidecar
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

$flutter = Get-FlutterExe
Write-Host "==> Using Flutter: $flutter"

Push-Location $AppDir

if (-not (Test-Path "windows")) {
  Write-Host "==> Generating Windows runner (flutter create)..."
  & $flutter create . --project-name liminal_desktop --platforms=windows
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# MSVC 18+ errors on permission_handler_windows' experimental/coroutine (STL1011).
function Patch-WindowsCmake {
  param([string]$CmakePath)
  if (-not (Test-Path $CmakePath)) { return }
  $cmake = Get-Content $CmakePath -Raw
  if ($cmake -match '_SILENCE_EXPERIMENTAL_COROUTINE') { return }
  $define = "add_compile_definitions(_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)"
  if ($cmake -match 'project\(liminal_desktop LANGUAGES CXX\)') {
    $cmake = $cmake -replace '(project\(liminal_desktop LANGUAGES CXX\)\r?\n)', "`$1$define`n"
  } else {
    $cmake = "$define`n$cmake"
  }
  Set-Content -Path $CmakePath -Value $cmake -Encoding utf8
}

Patch-WindowsCmake (Join-Path $AppDir "windows\CMakeLists.txt")

Write-Host "==> flutter pub get"
& $flutter pub get
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> flutter build windows --release"
& $flutter build windows --release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Pop-Location

$OutDir = Join-Path $AppDir "build\windows\x64\runner\Release"
$Exe = Join-Path $OutDir "liminal_desktop.exe"

Write-Host "==> Bundling portable liminald into Release folder..."
$bundleArgs = @{
  ReleaseDir = $OutDir
  RepoRoot   = $RepoRoot
}
if ($CopyNodeModulesFromRepo) { $bundleArgs["CopyNodeModulesFromRepo"] = $true }
& (Join-Path $RepoRoot "scripts\bundle-liminald-for-desktop.ps1") @bundleArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Build complete."
Write-Host "  Executable: $Exe"
Write-Host "  Sidecar:    $(Join-Path $OutDir 'liminald\repo')"
Write-Host "  Ship the entire Release folder (includes liminald + DLLs + data/)."
Write-Host ""
Write-Host "Dev run: cd apps\liminal_desktop; flutter run -d windows"
