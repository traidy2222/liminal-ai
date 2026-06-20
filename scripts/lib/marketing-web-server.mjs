/**
 * Ensure the web harness stack is reachable for headless marketing capture.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WEB_DIST = path.join(REPO_ROOT, "packages", "web", "client", "dist", "index.html");
const LOG_PATH = path.join(REPO_ROOT, "assets", "marketing", ".web-start.log");

import { probeWebApi } from "./marketing-web-auth.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiReachable(base) {
  return probeWebApi(base);
}

function ensureWebClientBuilt() {
  if (fs.existsSync(WEB_DIST)) return;
  console.log("[marketing:web] Building web client (first run — usually 2–5 min)…");
  const build = spawnSync("npm", ["run", "build:client", "--workspace=packages/web"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if ((build.status ?? 1) !== 0) {
    throw new Error("Web client build failed — run: npm run web");
  }
}

/**
 * @param {number} [timeoutMs]
 */
export async function ensureMarketingWebStack(timeoutMs = 300_000) {
  const apiBase = (process.env.MARKETING_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const uiFromEnv = process.env.MARKETING_UI_URL?.trim();
  const uiBase = uiFromEnv || apiBase;

  if (await apiReachable(apiBase)) {
    console.log(`[marketing:web] Using existing API ${apiBase}`);
    return { apiBase, uiBase, spawned: false, child: null };
  }

  ensureWebClientBuilt();

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const logFd = fs.openSync(LOG_PATH, "a");
  console.log(`[marketing:web] Starting API server (log: assets/marketing/.web-start.log)…`);

  const child = spawn("npm", ["run", "start", "--workspace=packages/web"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    shell: true,
    env: {
      ...process.env,
      AGENT_WEB_SKIP_CLIENT_BUILD: "1",
    },
  });
  child.unref();
  fs.closeSync(logFd);

  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    if (await apiReachable(apiBase)) {
      console.log(`[marketing:web] Ready at ${apiBase}`);
      return { apiBase, uiBase: apiBase, spawned: true, child };
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed - lastLog >= 30) {
      lastLog = elapsed;
      console.log(`[marketing:web] Waiting for API… ${elapsed}s`);
    }
    await sleep(2000);
  }

  throw new Error(
    `Web API not reachable at ${apiBase} after ${timeoutMs}ms — see assets/marketing/.web-start.log`
  );
}

/**
 * @param {import("node:child_process").ChildProcess | null} child
 */
export function stopSpawnedWeb(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true }).unref();
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* best-effort */
  }
}
