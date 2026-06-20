/**
 * Capture the native Liminal desktop window (Flutter) — 1:1 with what users see.
 * Windows: enumerate HWNDs by process ID (Get-Process MainWindowHandle breaks when minimized).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TITLE = "liminal_desktop";
const PROCESS_NAME = "liminal_desktop";

/** @type {number | null} */
let sessionHwnd = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @typedef {{ hwnd: number; title: string }} DesktopWindowTarget
 */

const ENUM_WINDOWS_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class LiminalWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  public struct RECT { public int L,T,R,B; }
  private static uint targetPid;
  private static long bestArea;
  private static IntPtr best;
  private static string bestTitle;
  private static bool EnumCallback(IntPtr h, IntPtr lParam) {
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid != targetPid) return true;
    int len = GetWindowTextLength(h);
    if (len <= 0) return true;
    var sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    string title = sb.ToString();
    if (string.IsNullOrWhiteSpace(title)) return true;
    RECT r;
    if (!GetWindowRect(h, out r)) return true;
    long area = (long)(r.R - r.L) * (r.B - r.T);
    if (area < 64 * 64) return true;
    if (area > bestArea) { bestArea = area; best = h; bestTitle = title; }
    return true;
  }
  public static string FindBest(uint pid) {
    targetPid = pid;
    bestArea = 0;
    best = IntPtr.Zero;
    bestTitle = "";
    EnumWindows(EnumCallback, IntPtr.Zero);
    if (best == IntPtr.Zero) return "";
    return best.ToInt64().ToString() + "\\t" + bestTitle;
  }
  public static bool Valid(long hwnd) {
    return hwnd > 0 && IsWindow(new IntPtr(hwnd));
  }
}
"@
`;

/**
 * @returns {Promise<DesktopWindowTarget | null>}
 */
async function resolveDesktopWindow() {
  if (process.platform !== "win32") return null;

  if (sessionHwnd && (await isHwndValid(sessionHwnd))) {
    const title = await getWindowTitle(sessionHwnd);
    return { hwnd: sessionHwnd, title: title || DEFAULT_TITLE };
  }

  try {
    const out = await runPowerShell(`
$p = Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  Write-Output ($p.MainWindowHandle.ToInt64().ToString() + [char]9 + $p.MainWindowTitle)
  exit 0
}
${ENUM_WINDOWS_PS}
$p2 = Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p2) { exit 0 }
$line = [LiminalWin]::FindBest([uint32]$p2.Id)
if ($line) { Write-Output $line }
`);
    const line = out.trim().split("\n").pop()?.trim() ?? "";
    if (!line) return null;
    const [hwndRaw, ...titleParts] = line.split("\t");
    const hwnd = Number(hwndRaw);
    const title = titleParts.join("\t").trim();
    if (!Number.isFinite(hwnd) || hwnd <= 0) return null;
    sessionHwnd = hwnd;
    return { hwnd, title: title || DEFAULT_TITLE };
  } catch (err) {
    console.warn(
      "[desktop] resolveDesktopWindow:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * @param {number} hwnd
 */
async function isHwndValid(hwnd) {
  try {
    const out = await runPowerShell(`
${ENUM_WINDOWS_PS}
if ([LiminalWin]::Valid(${hwnd})) { Write-Output "1" }
`);
    return out.trim() === "1";
  } catch {
    return false;
  }
}

/**
 * @param {number} hwnd
 */
async function getWindowTitle(hwnd) {
  try {
    const out = await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class T {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$s = New-Object System.Text.StringBuilder 512
[void][T]::GetWindowText([IntPtr]::new(${hwnd}), $s, 512)
Write-Output $s.ToString()
`);
    return out.trim();
  } catch {
    return "";
  }
}

/** Clear cached HWND (call when launching a fresh desktop instance). */
export function resetWindowTitleCache() {
  sessionHwnd = null;
}

/**
 * @param {number} [timeoutMs]
 * @returns {Promise<string>} window title (for logging)
 */
export async function waitForDesktopWindow(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const win = await resolveDesktopWindow();
    if (win) {
      sessionHwnd = win.hwnd;
      console.log(`[desktop] window ready: hwnd=${win.hwnd} (0x${(win.hwnd >>> 0).toString(16)}) title="${win.title}"`);
      return win.title;
    }
    await sleep(500);
  }
  throw new Error(
    `Desktop window not found after ${Math.round(timeoutMs / 1000)}s — is liminal_desktop.exe running?`
  );
}

/**
 * @param {string} fallback
 */
export async function resolveWindowTitle(fallback = DEFAULT_TITLE) {
  const win = await resolveDesktopWindow();
  return win?.title ?? fallback;
}

export const NO_FOCUS = process.env.MARKETING_CAPTURE_NO_FOCUS === "1";

/**
 * Flutter/Skia stops repainting when the window is minimized — PrintWindow then
 * returns the same stale bitmap for every frame. Unattended capture must keep
 * the window visible (without stealing focus) so the UI actually updates.
 * @param {{ activate?: boolean }} [opts]
 */
export async function ensureWindowVisibleForCapture(opts = {}) {
  if (process.platform !== "win32") return;
  const win = await resolveDesktopWindow();
  if (!win) return;
  const activate = opts.activate ?? !NO_FOCUS;
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$h = [IntPtr]::new(${win.hwnd})
if (${activate ? "$true" : "$false"}) {
  [WinFocus]::ShowWindow($h, 9) | Out-Null
  [WinFocus]::SetForegroundWindow($h) | Out-Null
} else {
  # SW_SHOWNOACTIVATE — visible for GPU repaint, no focus steal
  [WinFocus]::ShowWindow($h, 4) | Out-Null
}
`;
  await runPowerShell(ps);
  await sleep(activate ? 400 : 500);
}

/**
 * @param {string} [_title]
 */
export async function focusWindow(_title = DEFAULT_TITLE) {
  if (process.platform !== "win32" || NO_FOCUS) return;
  await ensureWindowVisibleForCapture({ activate: true });
}

/**
 * @param {string} outPath
 * @param {string} [_title]
 */
export async function captureWindowPng(outPath, _title = DEFAULT_TITLE) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const win = await resolveDesktopWindow();
  if (!win) {
    throw new Error(`Window not found: no capturable HWND for ${PROCESS_NAME}`);
  }
  await ensureWindowVisibleForCapture({ activate: !NO_FOCUS });

  // gdigrab when visible often tracks Flutter GPU updates better than PrintWindow.
  try {
    await captureWithFfmpeg(outPath, win.hwnd);
    return;
  } catch (err) {
    console.warn(
      "[desktop] gdigrab capture failed, trying PrintWindow:",
      err instanceof Error ? err.message : err
    );
  }

  try {
    await captureWithPowerShell(outPath, win.hwnd);
  } catch (err) {
    throw new Error(
      `All capture methods failed for hwnd=${win.hwnd}: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * @param {string} outPath
 * @param {number} hwnd
 */
async function captureWithFfmpeg(outPath, hwnd) {
  const attempts = [
    `hwnd=${hwnd}`,
    `hwnd=0x${(hwnd >>> 0).toString(16)}`,
  ];
  let lastErr = "";
  for (const hwndArg of attempts) {
    try {
      await new Promise((resolve, reject) => {
        const ff = spawn(
          "ffmpeg",
          ["-y", "-f", "gdigrab", "-draw_mouse", "0", "-i", hwndArg, "-frames:v", "1", outPath],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        let err = "";
        ff.stderr?.on("data", (d) => {
          err += d.toString();
        });
        ff.on("error", reject);
        ff.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg gdigrab exit ${code}: ${err.slice(-400)}`));
        });
      });
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastErr || "ffmpeg gdigrab failed");
}

/**
 * @param {string} outPath
 * @param {number} hwnd
 */
async function captureWithPowerShell(outPath, hwnd) {
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public struct RECT { public int L,T,R,B; }
}
"@
$h = [IntPtr]::new(${hwnd})
if ($h -eq [IntPtr]::Zero) { throw "Window handle invalid" }
$r = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -lt 64 -or $ht -lt 64) { throw "Window too small ($w x $ht)" }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 24, 24, 24))
$dc = $g.GetHdc()
$ok = [WinCap]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc)
if (-not $ok) { $g.Dispose(); $bmp.Dispose(); throw "PrintWindow returned false" }
$g.Dispose()
$bmp.Save(${JSON.stringify(outPath.replace(/\\/g, "\\\\"))}, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;
  await runPowerShell(ps);
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    ps.stdout?.on("data", (d) => {
      out += d.toString();
    });
    ps.stderr?.on("data", (d) => {
      err += d.toString();
    });
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`PowerShell exit ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

/**
 * Push desktop behind other windows without minimizing (minimize freezes Flutter paint).
 * @deprecated Prefer ensureWindowVisibleForCapture — do not minimize during capture.
 */
export async function minimizeDesktopWindow() {
  if (process.platform !== "win32") return;
  await ensureWindowVisibleForCapture({ activate: false });
}

export { DEFAULT_TITLE };
