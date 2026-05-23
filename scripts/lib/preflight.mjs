import { spawnSync } from "node:child_process";
import { log } from "./log.mjs";

/**
 * @param {string} versionOutput
 * @returns {number[] | null}
 */
function parseVersion(versionOutput) {
  const match = versionOutput.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {number[]} actual
 * @param {number[]} minimum
 */
function gteVersion(actual, minimum) {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) {
      return true;
    }
    if (actual[i] < minimum[i]) {
      return false;
    }
  }
  return true;
}

/** @returns {{ ok: true; version: string } | { ok: false; message: string }} */
export function checkNode() {
  const version = process.version;
  const parsed = parseVersion(version);
  if (!parsed || !gteVersion(parsed, [22, 0, 0])) {
    return {
      ok: false,
      message: `Node.js 22+ required (found ${version}). Install from https://nodejs.org/ or use nvm/fnm.`,
    };
  }
  return { ok: true, version };
}

/** @returns {{ ok: true; version: string } | { ok: false; message: string }} */
export function checkNpm() {
  const result = spawnSync("npm", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return { ok: false, message: "npm not found. Install Node.js 22+ with npm 10+." };
  }
  const version = (result.stdout ?? "").trim();
  const parsed = parseVersion(version);
  if (!parsed || !gteVersion(parsed, [10, 0, 0])) {
    return {
      ok: false,
      message: `npm 10+ required (found ${version || "unknown"}). Upgrade npm: npm install -g npm@latest`,
    };
  }
  return { ok: true, version };
}

/** @returns {{ ok: true } | { ok: false; message: string } | { ok: true; optional: true; message: string }} */
export function checkGit() {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return {
      ok: true,
      optional: true,
      message: "git not found (optional for `liminal update`; install git for clone-based installs).",
    };
  }
  return { ok: true };
}

/** @param {{ strict?: boolean }} [opts] */
export function runPreflight(opts = {}) {
  const { strict = true } = opts;
  let failed = false;

  const node = checkNode();
  if (node.ok) {
    log("ok", `Node ${node.version}`);
  } else {
    log("error", node.message);
    failed = true;
  }

  const npm = checkNpm();
  if (npm.ok) {
    log("ok", `npm ${npm.version}`);
  } else {
    log("error", npm.message);
    failed = true;
  }

  const git = checkGit();
  if ("optional" in git && git.optional) {
    log("warn", git.message);
  } else if (git.ok) {
    log("ok", "git available");
  }

  if (failed && strict) {
    return false;
  }
  return !failed;
}
