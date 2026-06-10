#!/usr/bin/env node
/**
 * **Desktop** marketing capture — real harness via `liminald`, real session logs,
 * screenshots of the actual Flutter desktop window (1:1 with the shipped app).
 *
 * Prereqs:
 *   - AGENT_API_KEY in .env
 *   - Built desktop: npm run desktop:build:windows
 *
 * Usage:
 *   npm run marketing:capture:desktop
 *   node scripts/capture-marketing-desktop.mjs --id desktop-code-ship-test
 *
 * Env:
 *   LIMINAL_DESKTOP_EXE — path to liminal_desktop.exe (auto-detected on Windows)
 *   LIMINAL_DESKTOP_TITLE — window title (default: liminal_desktop)
 *   MARKETING_DESKTOP_SKIP_LAUNCH=1 — reuse running desktop + sidecar handshake
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { messagesFromSessionJsonl, resolveSessionJsonlPath } from "./lib/marketing-jsonl.mjs";
import { framesToGif, framesToMp4 } from "./lib/marketing-media.mjs";
import { captureWindowPng, DEFAULT_TITLE, focusWindow } from "./lib/marketing-window-capture.mjs";
import { SidecarWsClient, waitForHandshake } from "./lib/sidecar-ws-client.mjs";
import { findPrompt, getMarketingPrompts, resolvePromptId } from "./lib/marketing-prompts.mjs";
import {
  applyMarketingModelToProcessEnv,
  ensureMarketingModelSidecar,
  marketingModelManifestFields,
} from "./lib/marketing-model.mjs";

applyMarketingModelToProcessEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RECORDINGS_DIR = path.join(REPO_ROOT, "assets", "marketing", "recordings");
const OUT_DIR = path.join(REPO_ROOT, "assets", "marketing");

const DEFAULT_EXE = path.join(
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

const INCLUDE_OPTIONAL = process.env.MARKETING_INCLUDE_OPTIONAL === "1";
/** Real harness prompts — shared with live capture; desktop window framing. */
const PROMPTS = getMarketingPrompts("desktop", INCLUDE_OPTIONAL);

function parseArgs(argv) {
  let only = null;
  let skipLaunch = process.env.MARKETING_DESKTOP_SKIP_LAUNCH === "1";
  let keepApp = false;
  let windowTitle = process.env.LIMINAL_DESKTOP_TITLE ?? DEFAULT_TITLE;
  let exe = process.env.LIMINAL_DESKTOP_EXE ?? DEFAULT_EXE;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--id" && argv[i + 1]) only = argv[++i];
    else if (argv[i] === "--exe" && argv[i + 1]) exe = path.resolve(argv[++i]);
    else if (argv[i] === "--title" && argv[i + 1]) windowTitle = argv[++i];
    else if (argv[i] === "--skip-launch") skipLaunch = true;
    else if (argv[i] === "--keep-app") keepApp = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node scripts/capture-marketing-desktop.mjs [options]

Options:
  --id <prompt-id>     Run one prompt (${PROMPTS.map((p) => p.id).join(", ")})
  --exe <path>         liminal_desktop.exe
  --title <title>      Window title for capture (default: ${DEFAULT_TITLE})
  --skip-launch        Reuse running desktop (handshake must exist)
  --keep-app           Do not kill desktop process on exit
`);
      process.exit(0);
    }
  }
  return { only, skipLaunch, keepApp, windowTitle, exe };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} exe
 */
async function launchDesktop(exe) {
  try {
    await fs.access(exe);
  } catch {
    throw new Error(
      `Desktop executable not found: ${exe}\nBuild with: npm run desktop:build:windows`
    );
  }
  console.log(`[desktop] Launching ${exe}`);
  const child = spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(exe),
    windowsHide: false,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

/**
 * @param {{ client: SidecarWsClient; spec: object; windowTitle: string }} ctx
 */
async function runOnePrompt({ client, spec, windowTitle }) {
  const recDir = path.join(RECORDINGS_DIR, spec.id);
  const framesDir = path.join(recDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  console.log(`\n[desktop] ▶ ${spec.id}`);

  const chatId = await client.createMarketingChat(spec, REPO_ROOT);
  console.log(`[desktop]   chat ${chatId}`);

  const unapprove = client.wireAutoApprove(chatId);
  try {
    await client.ensureBootstrapSkipped(chatId);
    await focusWindow(windowTitle);
    await sleep(1200);

    console.log("[desktop]   sending prompt…");
    await client.postMessageWhenIdle(chatId, spec.prompt);

    const framePaths = [];
    let i = 0;
    const pollStart = Date.now();

    while (Date.now() - pollStart < spec.maxWaitMs) {
      const fp = path.join(framesDir, `f${String(i).padStart(2, "0")}.png`);
      await captureWindowPng(fp, windowTitle);
      framePaths.push(fp);
      i++;

      if (client.turnEndedChats.has(chatId) && client.sawHarnessRunning(chatId)) break;
      await sleep(3000);
    }

    if (!client.sawHarnessRunning(chatId)) {
      console.log("[desktop]   waiting for harness turn…");
      await client.waitForTurnEnd(chatId, spec.maxWaitMs);
      const fp = path.join(framesDir, `f${String(i).padStart(2, "0")}.png`);
      await captureWindowPng(fp, windowTitle);
      framePaths.push(fp);
    }

    await client.waitHarnessIdle(Math.min(180_000, spec.maxWaitMs), chatId);
    await sleep(2000);

    const heroPng = path.join(OUT_DIR, `${spec.id}.png`);
    await captureWindowPng(heroPng, windowTitle);
    if (framePaths.length > 0) {
      await fs.copyFile(heroPng, framePaths[framePaths.length - 1]);
    }

    const jsonlPath = chatId ? await resolveSessionJsonlPath(chatId) : null;
    let messages = [];
    let meta = { tools: [] };
    if (jsonlPath) {
      const parsed = await messagesFromSessionJsonl(jsonlPath, spec.prompt);
      messages = parsed.messages;
      meta = parsed.meta;
      await fs.copyFile(jsonlPath, path.join(recDir, "session.jsonl"));
      console.log(`[desktop]   session log: ${jsonlPath} · ${meta.tools?.length ?? 0} tools`);
    } else {
      console.warn(`[desktop]   no session jsonl for ${chatId}`);
    }

    await fs.writeFile(
      path.join(recDir, "messages.json"),
      JSON.stringify(
        {
          prompt: spec.prompt,
          chatId,
          messages,
          meta,
          capturedAt: new Date().toISOString(),
          source: "desktop",
        },
        null,
        2
      ),
      "utf8"
    );

    const gifPath = path.join(OUT_DIR, `${spec.id}.gif`);
    const mp4Path = path.join(OUT_DIR, `${spec.id}.mp4`);
    if (framePaths.length > 1) {
      console.log("[desktop]   GIF + MP4…");
      await framesToGif(framePaths, gifPath);
      await framesToMp4(framePaths, mp4Path);
    }

    if (!messages.length || !(meta.tools?.length > 0)) {
      throw new Error(
        `${spec.id}: capture invalid — need session log with real tool calls (got ${meta.tools?.length ?? 0} tools)`
      );
    }

    return {
      id: spec.id,
      title: spec.title,
      subtitle: spec.subtitle,
      accent: spec.accent,
      prompt: spec.prompt,
      png: rel(heroPng),
      gif: framePaths.length > 1 ? rel(gifPath) : undefined,
      mp4: framePaths.length > 1 ? rel(mp4Path) : undefined,
      messagesPath: rel(path.join(recDir, "messages.json")),
      tools: meta.tools,
      durationMs: meta.durationMs,
      messageCount: messages.length,
      chatId,
      source: "desktop",
    };
  } finally {
    unapprove();
  }
}

function rel(abs) {
  return path.relative(REPO_ROOT, abs).replace(/\\/g, "/").replace(/^assets\//, "");
}

async function publishWebsiteHeroes() {
  const heroMap = [
    ["desktop-code-ship-test.png", path.join(REPO_ROOT, "assets", "desktop-ui.png")],
    ["desktop-repo-react-trace.png", path.join(OUT_DIR, "website-desktop-repo.png")],
    ["desktop-memory-recall.png", path.join(OUT_DIR, "website-desktop-memory.png")],
    ["desktop-web-research-cite.png", path.join(OUT_DIR, "website-desktop-research.png")],
  ];
  for (const [src, dest] of heroMap) {
    try {
      await fs.copyFile(path.join(OUT_DIR, src), dest);
    } catch {
      /* skip missing */
    }
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.error("[desktop] Window capture currently supports Windows only (build desktop for your OS separately).");
    process.exit(1);
  }

  const { only, skipLaunch, keepApp, windowTitle, exe } = parseArgs(process.argv);
  const specs = only
    ? (() => {
        const spec = findPrompt(only, "desktop", true);
        return spec ? [spec] : [];
      })()
    : PROMPTS;
  if (!specs.length) {
    console.error(`Unknown id: ${only} (resolved: ${resolvePromptId(only ?? "", "desktop")})`);
    process.exit(1);
  }

  let desktopPid = null;
  if (!skipLaunch) {
    desktopPid = await launchDesktop(exe);
    await sleep(4000);
  }

  console.log("[desktop] Waiting for sidecar handshake…");
  const handshake = await waitForHandshake(120_000);
  console.log(`[desktop] Sidecar ws://127.0.0.1:${handshake.port}`);

  const client = new SidecarWsClient(handshake.port, handshake.token);
  await client.connect();
  await ensureMarketingModelSidecar(client);

  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const results = [];
  for (const spec of specs) {
    try {
      results.push(await runOnePrompt({ client, spec, windowTitle }));
    } catch (err) {
      console.error(`[desktop] FAILED ${spec.id}:`, err instanceof Error ? err.message : err);
      results.push({ id: spec.id, source: "desktop", error: String(err) });
    }
  }

  client.close();
  await publishWebsiteHeroes();

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "desktop",
    windowTitle,
    exe: path.relative(REPO_ROOT, exe).replace(/\\/g, "/"),
    ...marketingModelManifestFields(),
    results,
  };
  await fs.writeFile(
    path.join(OUT_DIR, "desktop-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  console.log("\n[desktop] Done → assets/marketing/desktop-manifest.json");
  console.log(JSON.stringify(results, null, 2));

  if (!keepApp && desktopPid && process.platform === "win32") {
    spawn("taskkill", ["/PID", String(desktopPid), "/T", "/F"], { stdio: "ignore" }).unref();
  }

  const failed = results.filter((r) => r.error || !r.tools?.length);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
