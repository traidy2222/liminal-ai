#!/usr/bin/env node
/**
 * Unattended marketing capture — all prompts in one headless browser session.
 * Does not launch liminal_desktop or steal keyboard focus. Safe to run while you work.
 *
 *   npm run marketing:capture:unattended
 *   npm run marketing:publish          # uses this by default (+ website sync)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarketingCaptureStatus } from "./lib/marketing-capture-status.mjs";
import { ensureMarketingWebStack, stopSpawnedWeb } from "./lib/marketing-web-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let only = null;
  let skipWebStart = process.env.MARKETING_SKIP_WEB_START === "1";
  let keepWeb = process.env.MARKETING_KEEP_WEB === "1";
  let syncWebsite = false;
  let includeOptional = process.env.MARKETING_INCLUDE_OPTIONAL === "1";
  let website = process.env.VIREON_WEBSITE_ROOT?.trim() ?? "";

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id" && argv[i + 1]) only = argv[++i];
    else if (a === "--skip-web-start") skipWebStart = true;
    else if (a === "--keep-web") keepWeb = true;
    else if (a === "--sync") syncWebsite = true;
    else if (a === "--include-optional") includeOptional = true;
    else if (a === "--website" && argv[i + 1]) website = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/capture-marketing-unattended.mjs [options]

Runs headless web capture for all marketing prompts (one browser, batch chat).
Start in another terminal: npm run marketing:watch

Options:
  --id <prompt-id>     Single prompt only
  --skip-web-start     API must already be on MARKETING_API_URL
  --keep-web           Leave spawned web server running
  --sync               Sync assets to vireondynamics-website after capture
  --website <path>     Website repo for --sync
  --include-optional   Include 5th harness-test-run prompt
`);
      process.exit(0);
    }
  }

  if (!website) {
    for (const candidate of [
      path.join(REPO_ROOT, "..", "vireondynamics-website"),
      path.join(REPO_ROOT, "..", "..", "vireondynamics-website"),
    ]) {
      const resolved = path.resolve(candidate);
      try {
        if (fs.existsSync(path.join(resolved, "package.json"))) {
          website = resolved;
          break;
        }
      } catch {
        /* continue */
      }
    }
  }

  return {
    only,
    skipWebStart,
    keepWeb,
    syncWebsite,
    includeOptional,
    website: website ? path.resolve(website) : "",
  };
}

async function main() {
  const opts = parseArgs(process.argv);

  console.log(
    "\n[marketing:unattended] Headless batch capture — all prompts in one chat.\n" +
      "  Safe to keep using your PC. Watch progress: npm run marketing:watch\n"
  );

  const status = new MarketingCaptureStatus({
    repoRoot: REPO_ROOT,
    channel: "unattended",
    phase: "headless-web",
    promptIds: [],
  });
  await status.start();

  let webChild = null;
  let exitCode = 0;

  try {
    if (!opts.skipWebStart) {
      await status.setPhase("web-start");
      const stack = await ensureMarketingWebStack();
      webChild = stack.spawned ? stack.child : null;
      process.env.MARKETING_API_URL = stack.apiBase;
      process.env.MARKETING_UI_URL = stack.uiBase;
    }

    process.env.MARKETING_REUSE_CHAT = "1";
    process.env.MARKETING_CAPTURE_NO_FOCUS = "1";
    process.env.AGENT_YOLO = process.env.AGENT_YOLO ?? "1";
    if (opts.includeOptional) process.env.MARKETING_INCLUDE_OPTIONAL = "1";

    await status.setPhase("headless-capture");
    const args = ["scripts/capture-marketing-live.mjs"];
    if (opts.only) args.push("--id", opts.only);

    const r = spawnSync(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    exitCode = r.status ?? 1;

    if (opts.syncWebsite && opts.website && exitCode === 0) {
      await status.setPhase("website-sync");
      const sync = spawnSync(
        process.execPath,
        [path.join(opts.website, "scripts", "sync-marketing-captures.mjs")],
        {
          cwd: opts.website,
          stdio: "inherit",
          env: { ...process.env, LIMINAL_REPO_ROOT: REPO_ROOT },
        }
      );
      if (sync.status !== 0) exitCode = sync.status ?? 1;
    }

    await status.finish({
      ok: exitCode === 0,
      exitCode,
      message:
        exitCode === 0
          ? "Unattended marketing capture complete (headless web)"
          : `Unattended capture failed (exit ${exitCode})`,
    });
  } catch (err) {
    await status.fail(err);
    throw err;
  } finally {
    if (!opts.keepWeb) stopSpawnedWeb(webChild);
  }

  if (exitCode) process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
