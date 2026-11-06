# Read-only integration check against the running installed app. Does not use UI
# automation, send chat messages, or call a model/provider.
param([Parameter(Mandatory = $true)][string]$ExePath)
$ErrorActionPreference = "Stop"
$liminalExe = (Resolve-Path -LiteralPath $ExePath).Path
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LiminalDesktopIdentityCheck {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr handle, ref uint size, StringBuilder text);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr handle, ref uint size, StringBuilder text);
  public static string Read(uint pid, bool application) {
    IntPtr handle=OpenProcess(0x1000, false, pid);
    if(handle==IntPtr.Zero) throw new InvalidOperationException("Cannot query process identity: " + pid);
    try {
      uint size=1024;
      var text=new StringBuilder((int)size);
      int result=application ? GetApplicationUserModelId(handle, ref size, text) : GetPackageFullName(handle, ref size, text);
      if(result!=0) throw new InvalidOperationException("Process " + pid + " has no shared app identity (Windows error " + result + ").");
      return text.ToString();
    } finally { CloseHandle(handle); }
  }
}
'@
$liminalProcesses = @(Get-CimInstance Win32_Process)
$liminalRoots = @($liminalProcesses | Where-Object { $_.ExecutablePath -eq $liminalExe })
if ($liminalRoots.Count -ne 1) { throw "Expected one running Liminal UI host; found $($liminalRoots.Count)." }
$liminalOwned = [System.Collections.Generic.HashSet[uint32]]::new()
$null = $liminalOwned.Add([uint32]$liminalRoots[0].ProcessId)
do {
  $liminalAdded = $false
  foreach ($liminalChild in $liminalProcesses) {
    if ($liminalOwned.Contains([uint32]$liminalChild.ParentProcessId) -and $liminalOwned.Add([uint32]$liminalChild.ProcessId)) { $liminalAdded = $true }
  }
} while ($liminalAdded)
$liminalReport = @($liminalProcesses | Where-Object { $liminalOwned.Contains([uint32]$_.ProcessId) } | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    Pid = $_.ProcessId
    Parent = $_.ParentProcessId
    AppId = [LiminalDesktopIdentityCheck]::Read($_.ProcessId, $true)
    Package = [LiminalDesktopIdentityCheck]::Read($_.ProcessId, $false)
  }
})
if (@($liminalReport | Where-Object Name -eq 'node.exe').Count -ne 1) { throw "Expected one backend process." }
if (@($liminalReport.AppId | Select-Object -Unique).Count -ne 1 -or @($liminalReport.Package | Select-Object -Unique).Count -ne 1) {
  throw "Liminal processes do not share one Windows application/package identity."
}
[pscustomobject]@{ SharedAppIdentity = $true; Processes = $liminalReport } | ConvertTo-Json -Depth 4
