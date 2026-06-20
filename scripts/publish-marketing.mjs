#!/usr/bin/env node
/**
 * End-to-end marketing asset pipeline:
 *   1) Capture harness runs (default: unattended headless web — all prompts, one chat)
 *   2) Sync assets + regenerate website gallery (when website repo is found)
 *
 * Completion signals:
 *   - assets/marketing/.capture-status.json
 *   - stdout: MARKETING_CAPTURE_STATUS=completed ...
 *   - npm run marketing:watch  (poll until done)
 *
 * Usage:
 *   npm run marketing:publish              # headless web batch (recommended)
 *   npm run marketing:publish -- --with-desktop
 *   npm run marketing:publish -- --desktop-only
 *   node scripts/publish-marketing.mjs --skip-capture
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarketingCaptureStatus } from "./lib/marketing-capture-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let website = process.env.VIREON_WEBSITE_ROOT?.trim() ?? "";
  let captureUnattended = true;
  let captureDesktop = false;
  let captureLive = false;
  let skipCapture = false;
  let includeOptional = process.env.MARKETING_INCLUDE_OPTIONAL === "1";

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--website" && argv[i + 1]) website = argv[++i];
    else if (a === "--desktop-only") {
      captureUnattended = false;
      captureDesktop = true;
    } else if (a === "--with-desktop") captureDesktop = true;
    else if (a === "--live-only" || a === "--headed-live") {
      captureUnattended = false;
      captureLive = true;
    } else if (a === "--with-live") captureLive = true;
    else if (a === "--skip-capture") skipCapture = true;
    else if (a === "--include-optional") includeOptional = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/publish-marketing.mjs [options]

Default: unattended headless web capture (all prompts, one chat, no focus steal).
Safe to run while you work — start \`npm run marketing:watch\` in another terminal.

Options:
  --website <path>     vireondynamics-website root (or VIREON_WEBSITE_ROOT)
  --with-desktop       Also capture real Flutter window (minimized, batch chat)
  --desktop-only       Desktop capture only (legacy default)
  --headed-live        Visible browser; web stack must already be running
  --with-live          Also run headed live after unattended
  --skip-capture       Sync only — use existing assets/marketing/*
  --include-optional   Include 5th harness-test-run prompt

Monitor: npm run marketing:watch
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
      if (fs.existsSync(path.join(resolved, "package.json"))) {
        website = resolved;
        break;
      }
    }
  }

  return {
    website: website ? path.resolve(website) : "",
    captureUnattended,
    captureDesktop,
    captureLive,
    skipCapture,
    includeOptional,
  };
}

function runNode(script, extraEnv = {}, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", script), ...extraArgs],
    {
      stdio: "inherit",
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
    }
  );
  return r.status ?? 1;
}

function runWebsiteScript(websiteRoot, script) {
  const r = spawnSync(process.execPath, [path.join(websiteRoot, "scripts", script)], {
    stdio: "inherit",
    cwd: websiteRoot,
    env: { ...process.env, LIMINAL_REPO_ROOT: REPO_ROOT },
  });
  return r.status ?? 1;
}

async function main() {
  const opts = parseArgs(process.argv);
  const status = new MarketingCaptureStatus({
    repoRoot: REPO_ROOT,
    channel: "publish",
    phase: "publish",
    promptIds: [],
  });
  await status.start();

  let exitCode = 0;
  try {
    if (!opts.skipCapture) {
      const baseEnv = opts.includeOptional ? { MARKETING_INCLUDE_OPTIONAL: "1" } : {};

      if (opts.captureUnattended) {
        await status.setPhase("unattended-capture");
        console.log(
          "\n[publish-marketing] ▶ unattended capture (headless web, batch chat, auto-starts web)\n"
        );
        const code = runNode("capture-marketing-unattended.mjs", {
          ...baseEnv,
          MARKETING_SKIP_WEB_START: process.env.MARKETING_SKIP_WEB_START ?? "",
        });
        if (code !== 0) exitCode = code;
      }

      if (opts.captureDesktop && exitCode === 0) {
        await status.setPhase("desktop-capture");
        console.log("\n[publish-marketing] ▶ desktop capture\n");
        const code = runNode("capture-marketing-desktop.mjs", {
          ...baseEnv,
          MARKETING_REUSE_CHAT: "1",
          MARKETING_CAPTURE_NO_FOCUS: "1",
        });
        if (code !== 0) exitCode = code;
      }

      if (opts.captureLive && exitCode === 0) {
        await status.setPhase("live-capture");
        console.log(
          "\n[publish-marketing] ▶ headed live capture (requires web:dev or web running)\n"
        );
        const code = runNode("capture-marketing-live.mjs", {
          ...baseEnv,
          MARKETING_REUSE_CHAT: process.env.MARKETING_REUSE_CHAT ?? "1",
        });
        if (code !== 0) exitCode = code;
      }
    } else {
      console.log("[publish-marketing] Skipping capture (--skip-capture)");
      await status.setPhase("sync-only");
    }

    if (opts.website && exitCode === 0) {
      await status.setPhase("website-sync");
      console.log(`\n[publish-marketing] ▶ sync to website (${opts.website})\n`);
      const code = runWebsiteScript(opts.website, "sync-marketing-captures.mjs");
      if (code !== 0) exitCode = code;
    } else if (!opts.website) {
      console.warn(
        "[publish-marketing] Website repo not found — assets are in assets/marketing/ only.\n" +
          "Set VIREON_WEBSITE_ROOT or run: cd vireondynamics-website && npm run sync-marketing-captures"
      );
    }

    await status.finish({
      ok: exitCode === 0,
      exitCode,
      message:
        exitCode === 0
          ? "Marketing publish complete (capture + sync)"
          : `Marketing publish failed (exit ${exitCode})`,
    });

    console.log("\n[publish-marketing] Done.");
    if (exitCode) process.exit(exitCode);
  } catch (err) {
    await status.fail(err);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
