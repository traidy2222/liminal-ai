import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./log.mjs";
import { resolveRepoRoot } from "./paths.mjs";
import {
  checkDesktopUpdate,
  compareSemver,
  downloadAsset,
  extractLiminaldFromArchive,
  fetchSha256FromSidecar,
  isPortableDesktopInstall,
  readLocalHarnessVersion,
  resolveLatestDesktopRelease,
  applyHarnessSwap,
} from "./update-release.mjs";

/** @param {string} repoRoot */
function isGitRepository(repoRoot) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return r.status === 0 && r.stdout?.trim() === "true";
}

/**
 * Resolve portable desktop exe directory from env or cwd walk.
 * @returns {string | null}
 */
export function resolvePortableExeDir() {
  const fromEnv = process.env.LIMINAL_DESKTOP_EXE_DIR?.trim();
  if (fromEnv && isPortableDesktopInstall(fromEnv)) {
    return path.resolve(fromEnv);
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (isPortableDesktopInstall(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runReleaseUpdate(argv) {
  const checkOnly = argv.includes("--check");
  const jsonOut = argv.includes("--json");
  const harnessOnly = argv.includes("--harness-only");
  const channel = process.env.LIMINAL_UPDATE_CHANNEL === "beta" ? "beta" : "stable";
  const exeDir = resolvePortableExeDir();

  if (!exeDir) {
    const msg = "No portable Liminal Desktop install found (liminald/bundle.json).";
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, error: msg }));
    } else {
      log("error", msg);
    }
    return 1;
  }

  const appVersion =
    process.env.LIMINAL_APP_VERSION?.trim() ||
    readLocalHarnessVersion(exeDir) ||
    "0.0.0";

  try {
    const status = await checkDesktopUpdate({ exeDir, appVersion, channel });
    const payload = {
      ok: true,
      exeDir,
      current: {
        app: appVersion,
        harness: readLocalHarnessVersion(exeDir) ?? appVersion,
      },
      latest: status.latestVersion,
      tag: status.tag,
      notesUrl: status.notesUrl,
      harnessUpdate: status.harnessUpdate,
      appUpdate: status.appUpdate,
    };

    if (checkOnly) {
      if (jsonOut) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        log(
          "info",
          `Desktop ${payload.current.app} (harness ${payload.current.harness}) — latest ${payload.latest} (${payload.tag})`,
        );
        if (status.harnessUpdate) log("info", "Harness update available.");
        if (status.appUpdate) log("info", "App update available (restart required).");
        if (!status.harnessUpdate && !status.appUpdate) log("info", "Up to date.");
      }
      return 0;
    }

    if (!status.harnessUpdate && !status.appUpdate) {
      log("info", "Already up to date.");
      return 0;
    }

    if (status.harnessUpdate) {
      const asset = status.liminaldAsset;
      const sha256 = await fetchSha256FromSidecar(asset.sha256Url);
      const staging = path.join(os.tmpdir(), `liminald-${status.latestVersion}.zip`);
      log("info", `Downloading harness ${asset.file}…`);
      await downloadAsset(asset.url, staging, { expectedSha256: sha256 });
      const extractRoot = path.join(os.tmpdir(), `liminald-extract-${Date.now()}`);
      const liminaldPath = await extractLiminaldFromArchive(staging, extractRoot);
      applyHarnessSwap(exeDir, liminaldPath);
      log("info", `Harness updated to ${status.latestVersion}. Restart Liminal Desktop.`);
    }

    if (status.appUpdate && !harnessOnly) {
      log(
        "info",
        "App update requires restart — use Settings → Restart to update in the desktop app, or download the latest zip from GitHub Releases.",
      );
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      log("error", message);
    }
    return 1;
  }
}

export { compareSemver, resolveLatestDesktopRelease, isGitRepository };
