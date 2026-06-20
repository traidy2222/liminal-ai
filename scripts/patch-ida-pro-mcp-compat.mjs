#!/usr/bin/env node
/**
 * Patch ida-pro-mcp compat.py for IDA Pro 9.0 (pre-SP1).
 * Upstream hard-fails even though fallbacks already exist in the same file.
 *
 * Run after: pip install ida-pro-mcp  (or ida-pro-mcp --install)
 *   npm run ida:patch-compat
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PATCHED_MARKER = "using compat fallbacks (upgrade to 9.0 SP1+";

const OLD_BLOCK = `    if missing:
        ver_str = idaapi.get_kernel_version()
        raise RuntimeError(
            f"IDA Pro {ver_str} is missing required Python API methods: "
            f"{', '.join(missing)}. "
            f"If using IDA 9.0, please upgrade to IDA 9.0 SP1 or later."
        )`;

const NEW_BLOCK = `    if missing:
        ver_str = idaapi.get_kernel_version()
        note = (
            f"[ida-pro-mcp] IDA Pro {ver_str} lacks {', '.join(missing)} — "
            f"using compat fallbacks (upgrade to 9.0 SP1+ for native APIs)."
        )
        try:
            idaapi.msg(note + "\\n")
        except Exception:
            pass`;

function discoverCompatPaths() {
  const paths = new Set();
  const appData = process.env.APPDATA;
  if (appData) {
    paths.add(path.join(appData, "Hex-Rays", "IDA Pro", "plugins", "ida_mcp", "compat.py"));
  }

  const pyRoots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Python"),
    path.join(os.homedir(), "AppData", "Roaming", "Python"),
    process.env.PYTHONUSERBASE,
  ].filter(Boolean);

  for (const root of pyRoots) {
    if (!fs.existsSync(root)) continue;
    walkForCompat(root, paths, 6);
  }

  return [...paths].filter((p) => fs.existsSync(p));
}

function walkForCompat(dir, out, depth) {
  if (depth <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walkForCompat(full, out, depth - 1);
    } else if (e.name === "compat.py" && full.replace(/\\/g, "/").includes("ida_mcp/compat.py")) {
      out.add(full);
    }
  }
}

function patchFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (text.includes(PATCHED_MARKER)) {
    return { filePath, status: "already_patched" };
  }
  if (!text.includes(OLD_BLOCK)) {
    return { filePath, status: "skipped", reason: "unexpected compat.py layout" };
  }
  fs.writeFileSync(filePath, text.replace(OLD_BLOCK, NEW_BLOCK), "utf8");
  return { filePath, status: "patched" };
}

const results = discoverCompatPaths().map(patchFile);
if (results.length === 0) {
  console.error("No ida_mcp/compat.py found. Install ida-pro-mcp first:");
  console.error("  pip install git+https://github.com/mrexodia/ida-pro-mcp");
  console.error("  ida-pro-mcp --install");
  process.exit(1);
}

for (const r of results) {
  console.log(`${r.status}: ${r.filePath}${r.reason ? ` (${r.reason})` : ""}`);
}

if (results.every((r) => r.status === "skipped")) {
  process.exit(1);
}

console.log("\nRestart IDA (or re-run Edit → Plugins → MCP). Headless: restart idalib-mcp.");
