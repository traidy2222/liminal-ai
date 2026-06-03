import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile, resolvePort } from "../envWriter.mjs";
import { log } from "../log.mjs";
import { envPath, resolveRepoRoot } from "../paths.mjs";
import { scheduleBrowserOpen } from "../openBrowser.mjs";
import { resolveAutoUpdatePolicy, runRepoSync } from "../update.mjs";

const SCRIPTS_DIR = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runWeb(argv) {
  const bootstrap = argv.includes("--bootstrap");
  const open = argv.includes("--open");
  const dev = argv.includes("--dev");
  const yolo = argv.includes("--yolo");

  const repoRoot = resolveRepoRoot();
  const updatePolicy = resolveAutoUpdatePolicy(argv);
  if (updatePolicy) {
    const syncCode = runRepoSync(repoRoot, updatePolicy);
    if (syncCode !== 0) {
      return syncCode;
    }
  }
  const env = readEnvFile(envPath(repoRoot));
  const port = resolvePort(env);

  /** @type {Record<string, string | undefined>} */
  const extraEnv = {
    ...(bootstrap ? { AGENT_PERSONA_BOOTSTRAP_FORCE: "1" } : {}),
    ...(yolo ? { AGENT_YOLO: "1" } : {}),
  };

  const script = dev ? "run-web-dev.mjs" : "run-web.mjs";
  const scriptPath = path.join(SCRIPTS_DIR, script);
  if (!fs.existsSync(scriptPath)) {
    log("error", `Missing ${scriptPath}`);
    return 1;
  }

  if (open) {
    scheduleBrowserOpen(port);
  }

  const args = [scriptPath];
  if (bootstrap) {
    args.push("--bootstrap");
  }
  if (yolo) {
    args.push("--yolo");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function runTui(argv) {
  const bootstrap = argv.includes("--bootstrap");
  const yolo = argv.includes("--yolo");

  const repoRoot = resolveRepoRoot();
  const updatePolicy = resolveAutoUpdatePolicy(argv);
  if (updatePolicy) {
    const syncCode = runRepoSync(repoRoot, updatePolicy);
    if (syncCode !== 0) {
      return syncCode;
    }
  }
  const scriptPath = path.join(SCRIPTS_DIR, "run-tui.mjs");
  if (!fs.existsSync(scriptPath)) {
    log("error", `Missing ${scriptPath}`);
    return 1;
  }

  /** @type {Record<string, string | undefined>} */
  const extraEnv = {
    ...(bootstrap ? { AGENT_PERSONA_BOOTSTRAP_FORCE: "1" } : {}),
    ...(yolo ? { AGENT_YOLO: "1" } : {}),
  };

  const args = [scriptPath];
  if (bootstrap) {
    args.push("--bootstrap");
  }
  if (yolo) {
    args.push("--yolo");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

/**
 * @returns {number}
 */
export function runUpdate() {
  const repoRoot = resolveRepoRoot();
  return runRepoSync(repoRoot, { pull: true, install: true, build: true });
}
