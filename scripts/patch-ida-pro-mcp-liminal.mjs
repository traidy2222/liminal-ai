#!/usr/bin/env node
/**
 * Install Liminal RE extensions into ida-pro-mcp (apply_patches_to_input, get_input_metadata).
 *
 * Run after pip install ida-pro-mcp:
 *   npm run ida:patch-liminal
 *
 * Also runs compat patch (IDA 9.0 pre-SP1) when scripts/patch-ida-pro-mcp-compat.mjs exists.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_API = path.join(__dirname, "ida-pro-mcp-liminal", "api_liminal_export.py");
const INIT_MARKER = "from . import api_liminal_export";
const INIT_LINE = "from . import api_liminal_export  # liminal: patched binary export";

function discoverIdaMcpRoots() {
  const roots = new Set();
  const pyRoots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Python"),
    path.join(os.homedir(), "AppData", "Roaming", "Python"),
    process.env.PYTHONUSERBASE,
    process.env.VIRTUAL_ENV && path.join(process.env.VIRTUAL_ENV, "Lib", "site-packages"),
  ].filter(Boolean);

  for (const root of pyRoots) {
    if (!fs.existsSync(root)) continue;
    walkForPackage(root, roots, 7);
  }

  // pip show fallback
  const pip = spawnSync("python", ["-c", "import ida_pro_mcp, os; print(os.path.dirname(ida_pro_mcp.__file__))"], {
    encoding: "utf8",
  });
  if (pip.status === 0) {
    const p = pip.stdout.trim();
    if (p && fs.existsSync(p)) roots.add(p);
  }

  return [...roots];
}

function walkForPackage(dir, out, depth) {
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
      if (e.name === "ida_pro_mcp" && fs.existsSync(path.join(full, "ida_mcp", "__init__.py"))) {
        out.add(full);
        continue;
      }
      if (e.name === "node_modules" || e.name === ".git") continue;
      walkForPackage(full, out, depth - 1);
    }
  }
}

function patchInit(initPath) {
  let text = fs.readFileSync(initPath, "utf8");
  if (text.includes(INIT_MARKER)) {
    return "already";
  }
  const anchor = "from . import api_sigmaker";
  if (!text.includes(anchor)) {
    return "skipped:missing_anchor";
  }
  text = text.replace(anchor, `${INIT_LINE}\n${anchor}`);
  fs.writeFileSync(initPath, text, "utf8");
  return "patched";
}

function installApi(idaMcpRoot) {
  const destDir = path.join(idaMcpRoot, "ida_mcp");
  const destApi = path.join(destDir, "api_liminal_export.py");
  const initPath = path.join(destDir, "__init__.py");
  if (!fs.existsSync(SOURCE_API)) {
    return { root: idaMcpRoot, status: "error", reason: "source api missing" };
  }
  fs.copyFileSync(SOURCE_API, destApi);
  const initStatus = patchInit(initPath);
  return { root: idaMcpRoot, status: "ok", init: initStatus, api: destApi };
}

const compatScript = path.join(REPO_ROOT, "scripts", "patch-ida-pro-mcp-compat.mjs");
if (fs.existsSync(compatScript)) {
  const compat = spawnSync(process.execPath, [compatScript], { stdio: "inherit", cwd: REPO_ROOT });
  if (compat.status !== 0) {
    console.warn("[ida:patch-liminal] compat patch reported issues (continuing)");
  }
}

const roots = discoverIdaMcpRoots();
if (roots.length === 0) {
  console.error("ida-pro-mcp not found. Install first:");
  console.error("  pip install ida-pro-mcp");
  process.exit(1);
}

const results = roots.map(installApi);
for (const r of results) {
  console.log(`${r.status}: ${r.root}${r.init ? ` (init: ${r.init})` : ""}${r.reason ? ` — ${r.reason}` : ""}`);
}

if (!results.some((r) => r.status === "ok")) {
  process.exit(1);
}

console.log("\nRestart idalib-mcp / IDA MCP plugin. New tools: apply_patches_to_input, get_input_metadata.");
