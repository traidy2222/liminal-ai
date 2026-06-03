import { spawnSync } from "node:child_process";
import { log } from "./log.mjs";
import { needsInstall, runNpm } from "./run.mjs";

/**
 * Auto-sync before launch (default for `liminal web` / `liminal tui`):
 * git pull --ff-only (when clean tree) → npm install → npm run build.
 *
 * Opt out: --no-update | LIMINAL_SKIP_UPDATE=1 | LIMINAL_AUTO_UPDATE=0
 * Skip pull only: --no-pull
 */
export function resolveAutoUpdatePolicy(argv) {
  if (
    argv.includes("--no-update") ||
    process.env.LIMINAL_SKIP_UPDATE === "1" ||
    process.env.LIMINAL_AUTO_UPDATE === "0"
  ) {
    return null;
  }
  return {
    pull: !argv.includes("--no-pull"),
    install: !argv.includes("--no-install"),
    build: !argv.includes("--no-build"),
  };
}

/** @param {string} repoRoot */
function isGitRepository(repoRoot) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return r.status === 0 && r.stdout?.trim() === "true";
}

/** @param {string} repoRoot */
function hasLocalChanges(repoRoot) {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return Boolean(r.stdout?.trim());
}

/**
 * @param {string} repoRoot
 * @param {{ pull?: boolean; install?: boolean; build?: boolean }} policy
 * @returns {number}
 */
export function runRepoSync(repoRoot, policy = {}) {
  const pull = policy.pull !== false;
  const install = policy.install !== false;
  const build = policy.build !== false;

  log("info", `Syncing ${repoRoot}…`);

  if (pull && isGitRepository(repoRoot)) {
    if (hasLocalChanges(repoRoot)) {
      log(
        "info",
        "Uncommitted changes — skipping git pull (commit + push, then rerun, or use --no-pull).",
      );
    } else {
      const pullResult = spawnSync("git", ["pull", "--ff-only"], {
        cwd: repoRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (pullResult.status !== 0) {
        log("warn", "git pull failed — continuing with the local tree.");
      }
    }
  } else if (pull) {
    log("info", "Not a git checkout — skipping pull.");
  }

  if (install) {
    if (needsInstall(repoRoot)) {
      log("info", "Installing dependencies…");
    }
    const installCode = runNpm(repoRoot, ["install"]);
    if (installCode !== 0) {
      return installCode;
    }
  }

  if (build) {
    log("info", "Building packages…");
    const buildCode = runNpm(repoRoot, ["run", "build"]);
    if (buildCode !== 0) {
      return buildCode;
    }
  }

  log("info", "Sync complete.");
  return 0;
}
