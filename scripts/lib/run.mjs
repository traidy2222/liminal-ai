import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} repoRoot
 * @param {string[]} npmArgs
 * @param {Record<string, string | undefined>} [extraEnv]
 * @returns {number}
 */
export function runNpm(repoRoot, npmArgs, extraEnv = {}) {
  const result = spawnSync("npm", npmArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

/**
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function needsInstall(repoRoot) {
  return !fs.existsSync(path.join(repoRoot, "node_modules"));
}

/**
 * @param {string} repoRoot
 * @param {{ coreMain: string; toolsDist: string }} paths
 */
export function needsBuild(repoRoot, paths) {
  return !fs.existsSync(paths.coreMain) || !fs.existsSync(path.join(paths.toolsDist, "index.js"));
}

/**
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {Record<string, string | undefined>} extraEnv
 * @returns {number}
 */
export function runNodeScript(scriptPath, args, extraEnv = {}) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {Record<string, string | undefined>} extraEnv
 * @returns {Promise<number>}
 */
export async function runNodeScriptAsync(scriptPath, args, extraEnv = {}) {
  return runNodeScript(scriptPath, args, extraEnv);
}
