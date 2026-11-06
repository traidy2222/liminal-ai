# Register the existing desktop build as a package for local development.
# Local development uses Windows' already-enabled Developer Mode. Production
# installers must use a signed MSIX instead of enabling Developer Mode.
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [string]$SignedPackage = "",
  [switch]$LocalDevelopment
)
$ErrorActionPreference = "Stop"
$liminalRelease = (Resolve-Path -LiteralPath $ReleaseDir).Path
$liminalManifest = Join-Path $liminalRelease "AppxManifest.xml"
if (-not (Test-Path -LiteralPath (Join-Path $liminalRelease "liminal_desktop.exe"))) {
  throw "Liminal executable missing from ReleaseDir."
}
if ($SignedPackage) {
  Add-AppxPackage -Path (Resolve-Path -LiteralPath $SignedPackage).Path
} elseif ($LocalDevelopment) {
  $liminalDeveloperMode = Get-ItemPropertyValue -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
  if ($liminalDeveloperMode -ne 1) {
    throw "Local identity registration requires Developer Mode to already be enabled. Use a signed package for distribution."
  }
  Add-AppxPackage -Register $liminalManifest
} else {
  throw "Supply -SignedPackage for installation or -LocalDevelopment for this PC."
}
Get-AppxPackage -Name VireonDynamics.Liminal | Select-Object Name, PackageFamilyName, Status
