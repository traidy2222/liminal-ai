/**
 * Capture the native Liminal desktop window (Flutter) — 1:1 with what users see.
 * Windows: ffmpeg gdigrab by window title, PowerShell PrintWindow fallback.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TITLE = "liminal_desktop";
const PROCESS_NAME = "liminal_desktop";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let cachedTitle = null;

/**
 * Resolve the real window title from the running liminal_desktop process.
 * The Flutter window-manager chrome retitles the native window at runtime
 * ("Liminal" / persona display label), so a hardcoded title goes stale —
 * find the process's main window and use whatever title it actually has.
 *
 * @param {string} fallback
 * @returns {Promise<string>}
 */
export async function resolveWindowTitle(fallback = DEFAULT_TITLE) {
  if (process.platform !== "win32") return fallback;
  if (cachedTitle) return cachedTitle;
  try {
    const out = await runPowerShell(
      `$p = Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1; if ($p) { $p.MainWindowTitle }`
    );
    const title = out.trim();
    if (title) {
      if (title !== fallback) {
        console.log(`[desktop] window title resolved: "${title}" (was expecting "${fallback}")`);
      }
      cachedTitle = title;
      return title;
    }
  } catch {
    /* fall through to the configured title */
  }
  return fallback;
}

/**
 * @param {string} title
 */
export async function focusWindow(title = DEFAULT_TITLE) {
  if (process.platform !== "win32") return;
  title = await resolveWindowTitle(title);
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$h = [WinFocus]::FindWindow($null, ${JSON.stringify(title)})
if ($h -ne [IntPtr]::Zero) {
  [WinFocus]::ShowWindow($h, 9) | Out-Null
  [WinFocus]::SetForegroundWindow($h) | Out-Null
}
`;
  await runPowerShell(ps);
  await sleep(400);
}

/**
 * @param {string} outPath
 * @param {string} [title]
 */
export async function captureWindowPng(outPath, title = DEFAULT_TITLE) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  title = await resolveWindowTitle(title);
  await focusWindow(title);

  try {
    await captureWithFfmpeg(outPath, title);
    return;
  } catch (err) {
    console.warn("[desktop] ffmpeg capture failed, trying PowerShell:", err instanceof Error ? err.message : err);
  }

  await captureWithPowerShell(outPath, title);
}

async function captureWithFfmpeg(outPath, title) {
  await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-y", "-f", "gdigrab", "-draw_mouse", "0", "-i", `title=${title}`, "-frames:v", "1", outPath],
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
}

async function captureWithPowerShell(outPath, title) {
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, int f);
  public struct RECT { public int L,T,R,B; }
}
"@
$h = [WinCap]::FindWindow($null, ${JSON.stringify(title)})
if ($h -eq [IntPtr]::Zero) { throw "Window not found: ${title}" }
$r = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -lt 64 -or $ht -lt 64) { throw "Window too small" }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
[void][WinCap]::PrintWindow($h, $g.GetHdc(), 2)
$g.ReleaseHdc()
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
      else reject(new Error(`PowerShell exit ${code}: ${err.trim()}`));
    });
  });
}

export { DEFAULT_TITLE };
