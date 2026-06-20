#!/usr/bin/env node
/**
 * Poll marketing capture status until done — for humans and agents monitoring long runs.
 *
 *   npm run marketing:watch          # block until completed/failed
 *   npm run marketing:status         # print once and exit
 *   node scripts/watch-marketing-capture.mjs --wait --notify
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isStaleTerminalStatus,
  readCaptureStatus,
  statusFilePath,
} from "./lib/marketing-capture-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let wait = false;
  let notify = process.env.MARKETING_CAPTURE_NOTIFY === "1";
  let json = false;
  let intervalMs = 3000;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wait" || a === "-w") wait = true;
    else if (a === "--notify" || a === "-n") notify = true;
    else if (a === "--json") json = true;
    else if (a === "--interval" && argv[i + 1]) intervalMs = Number(argv[++i]) || 3000;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/watch-marketing-capture.mjs [options]

Options:
  --wait, -w       Block until status is completed or failed
  --notify, -n     Set MARKETING_CAPTURE_NOTIFY=1 for capture scripts (this only polls)
  --json           Print full status JSON once
  --interval <ms>  Poll interval when waiting (default 3000)

Exit codes:
  0  completed
  1  failed or error
  2  still running (no --wait)
  3  no status file (never started)

Status file: ${statusFilePath(REPO_ROOT)}
Sentinel line in capture logs: MARKETING_CAPTURE_STATUS=completed ...
`);
      process.exit(0);
    }
  }

  return { wait, notify, json, intervalMs };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatStatus(s) {
  if (!s) return "no capture in progress";
  const cur = s.currentPrompt ? ` · ${s.currentPrompt}` : "";
  const elapsed =
    s.promptElapsedSec != null
      ? ` · ${s.promptElapsedSec}s`
      : s.currentPrompt && s.prompts?.find((p) => p.id === s.currentPrompt)?.startedAt
        ? ` · ${Math.round((Date.now() - Date.parse(s.prompts.find((p) => p.id === s.currentPrompt).startedAt)) / 1000)}s`
        : "";
  const frames = s.frameProgress != null ? ` · ${s.frameProgress} frames` : "";
  return `[${s.status}] ${s.phase ?? s.channel}${cur}${elapsed}${frames} — ${s.summary ?? "…"}`;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.notify) process.env.MARKETING_CAPTURE_NOTIFY = "1";

  while (true) {
    const status = await readCaptureStatus(REPO_ROOT);

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      if (!status) process.exit(3);
      process.exit(status.status === "completed" ? 0 : status.status === "failed" ? 1 : 2);
    }

    if (!status) {
      console.log("[marketing:watch] No status file — capture not started.");
      console.log(`[marketing:watch] Expected: ${statusFilePath(REPO_ROOT)}`);
      if (!opts.wait) process.exit(3);
      await sleep(opts.intervalMs);
      continue;
    }

    if (isStaleTerminalStatus(status)) {
      if (opts.wait) {
        console.log(
          `[marketing:watch] Ignoring stale ${status.status} from prior run (pid ${status.pid} exited) — waiting for new capture…`
        );
        await sleep(opts.intervalMs);
        continue;
      }
      console.log(
        `[marketing:watch] ${formatStatus(status)} (stale — process ended; not an active run)`
      );
      process.exit(status.status === "completed" ? 0 : 1);
    }

    console.log(`[marketing:watch] ${formatStatus(status)}`);

    if (status.status === "completed") {
      console.log("[marketing:watch] Done.");
      process.exit(0);
    }
    if (status.status === "failed") {
      console.error("[marketing:watch] Capture failed.");
      process.exit(1);
    }

    if (!opts.wait) process.exit(2);
    await sleep(opts.intervalMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
