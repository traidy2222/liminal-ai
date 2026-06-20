/**
 * Sidecar bootstrap helpers for desktop marketing capture.
 * Ensures we connect to a fresh liminald and that the Flutter shell does not
 * kill the sidecar on health-check reconnect (LIMINALD_ATTACH=1).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function liminalHome() {
  return process.env.LIMINAL_HOME?.trim() || path.join(os.homedir(), ".liminal");
}

export function sidecarHandshakePath() {
  return path.join(liminalHome(), "sidecar.json");
}

/**
 * @returns {Promise<{ port: number; token: string; pid?: number; startedAt?: number } | null>}
 */
export async function readSidecarHandshake() {
  try {
    const text = await fs.readFile(sidecarHandshakePath(), "utf8");
    const json = JSON.parse(text);
    if (json.port && json.token) return json;
  } catch {
    /* missing or mid-write */
  }
  return null;
}

/**
 * Kill liminald from the handshake pid, then remove sidecar.json.
 */
export async function killStaleSidecar() {
  const hs = await readSidecarHandshake();
  if (hs?.pid && process.platform === "win32") {
    console.log(`[desktop] Stopping stale liminald (pid ${hs.pid})…`);
    await new Promise((resolve) => {
      const t = spawn("taskkill", ["/PID", String(hs.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
      });
      t.on("close", () => resolve());
      t.on("error", () => resolve());
    });
    await sleep(800);
  } else if (hs?.pid) {
    try {
      process.kill(hs.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    await sleep(400);
  }
  try {
    await fs.rm(sidecarHandshakePath(), { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Stop any running liminal_desktop.exe (process tree on Windows).
 */
export async function killExistingDesktop() {
  if (process.platform !== "win32") return;
  console.log("[desktop] Stopping any running liminal_desktop.exe…");
  await new Promise((resolve) => {
    const t = spawn("taskkill", ["/IM", "liminal_desktop.exe", "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });
    t.on("close", () => resolve());
    t.on("error", () => resolve());
  });
  await sleep(1500);
}

/**
 * Poll sidecar.json until a handshake newer than [minStartedAt] appears.
 * @param {number} [minStartedAt] epoch ms — reject handshakes from prior runs
 * @param {number} [timeoutMs]
 */
export async function waitForFreshHandshake(minStartedAt = 0, timeoutMs = 120_000) {
  const file = sidecarHandshakePath();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const text = await fs.readFile(file, "utf8");
      const json = JSON.parse(text);
      const startedAt = Number(json.startedAt ?? 0);
      if (json.port && json.token && startedAt >= minStartedAt) {
        return json;
      }
    } catch {
      /* mid-write */
    }
    await sleep(250);
  }
  throw new Error(
    `Fresh sidecar handshake not found (${file}) after ${Math.round(timeoutMs / 1000)}s`
  );
}

/** @deprecated Use waitForFreshHandshake */
export async function waitForHandshake(timeoutMs = 90_000) {
  return waitForFreshHandshake(0, timeoutMs);
}

export const DEFAULT_DESKTOP_EXE = path.join(
  REPO_ROOT,
  "apps",
  "liminal_desktop",
  "build",
  "windows",
  "x64",
  "runner",
  "Release",
  "liminal_desktop.exe"
);

/**
 * Env vars for desktop spawned by marketing capture.
 * LIMINALD_ATTACH=1 — Flutter must not kill liminald on reconnect (breaks capture WS).
 */
export function marketingDesktopChildEnv(extra = {}) {
  return {
    ...process.env,
    LIMINAL_MARKETING_CAPTURE: "1",
    LIMINALD_ATTACH: "1",
    ...extra,
  };
}
