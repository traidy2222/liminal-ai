#!/usr/bin/env node
/**
 * Apply a downloaded desktop update (harness swap or deferred app relaunch).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve lib modules from repo scripts/ or bundled liminald/updater/. */
function libPath(name) {
  const flat = path.join(__dirname, name);
  if (fs.existsSync(flat)) return flat;
  return path.join(__dirname, "lib", name);
}

const {
  applyHarnessSwap,
  extractAppArchive,
  extractLiminaldFromArchive,
  waitForProcessExit,
} = await import(pathToFileURL(libPath("update-release.mjs")).href);
const { applyAppFolderSwap, relaunchInstalledApp } = await import(
  pathToFileURL(libPath("apply-app-swap.mjs")).href
);

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {
    mode: "",
    exeDir: "",
    archive: "",
    platform:
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (a === "--exe-dir" && argv[i + 1])
      out.exeDir = path.resolve(argv[++i]);
    else if (a === "--archive" && argv[i + 1])
      out.archive = path.resolve(argv[++i]);
    else if (a === "--platform" && argv[i + 1]) out.platform = argv[++i];
    else if (a === "--relaunch-pid" && argv[i + 1]) out.relaunchPid = argv[++i];
    else if (a === "--ready-file" && argv[i + 1]) out.readyFile = path.resolve(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !args.exeDir || !args.archive) {
    console.error(
      "Required: --mode harness|app --exe-dir <dir> --archive <path>",
    );
    process.exit(1);
  }

  if (args.mode === "harness") {
    const stagingRoot = path.join(args.exeDir, ".update-staging");
    const liminaldPath = await extractLiminaldFromArchive(
      args.archive,
      stagingRoot,
    );
    const result = applyHarnessSwap(args.exeDir, liminaldPath);
    console.log(JSON.stringify({ ok: true, backup: result.backup }));
    return;
  }

  if (args.mode === "app") {
    if (args.readyFile) fs.writeFileSync(args.readyFile, "ready", { flag: "wx" });
    const pid = Number(args.relaunchPid || process.ppid);
    if (pid > 0) {
      console.log(`Waiting for parent PID ${pid} to exit…`);
      if (!waitForProcessExit(pid)) throw Error("Timed out waiting for the current app to exit");
    }
    try {
      const extracted = await extractAppArchive(
        args.exeDir,
        args.archive,
        args.platform,
      );
      await applyAppFolderSwap({
        exeDir: args.exeDir,
        extractedRoot: extracted,
        platform: args.platform,
      });
    } catch (error) {
      try {
        fs.writeFileSync(
          path.join(args.exeDir, "last_update_error.txt"),
          error instanceof Error ? error.message : String(error),
        );
      } catch {}
      if (!error?.updateRecoveryAttempted) {
        try {
          await relaunchInstalledApp(args.exeDir, args.platform);
        } catch {}
      }
      throw error;
    }
    console.log(JSON.stringify({ ok: true }));
    fs.rmSync(path.join(args.exeDir, "pending_update.json"), { force: true });
    return;
  }

  console.error(`Unknown mode: ${args.mode}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
