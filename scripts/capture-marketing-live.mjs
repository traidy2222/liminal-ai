#!/usr/bin/env node
/**
 * **Live** marketing capture — real harness, real tools, real session logs.
 *
 * Prereqs: API key in .env, web stack running.
 *   npm run web:dev   → UI http://localhost:5173  API http://localhost:3001
 *   npm run web       → UI+API http://localhost:3001
 *
 * Usage:
 *   npm run marketing:capture:live
 *   node scripts/capture-marketing-live.mjs --id live-code-ship-test
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { messagesFromSessionJsonl, resolveSessionJsonlPath, isLatestTurnComplete } from "./lib/marketing-jsonl.mjs";
import { findPrompt, getMarketingPrompts, resolvePromptId } from "./lib/marketing-prompts.mjs";
import { prepMarketingWorkspace } from "./lib/marketing-workspace-prep.mjs";
import { MarketingCaptureStatus } from "./lib/marketing-capture-status.mjs";
import { probeWebApi, resolveWebAuthToken, webAuthHeaders } from "./lib/marketing-web-auth.mjs";
import {
  applyMarketingModelToProcessEnv,
  ensureMarketingModelLive,
  marketingModelManifestFields,
} from "./lib/marketing-model.mjs";

applyMarketingModelToProcessEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RECORDINGS_DIR = path.join(REPO_ROOT, "assets", "marketing", "recordings");
const OUT_DIR = path.join(REPO_ROOT, "assets", "marketing");

const INCLUDE_OPTIONAL = process.env.MARKETING_INCLUDE_OPTIONAL === "1";
const PROMPTS = getMarketingPrompts("live", INCLUDE_OPTIONAL);

const VIEWPORT = { width: 1280, height: 800 };

function parseArgs(argv) {
  let apiBase = process.env.MARKETING_API_URL ?? "http://localhost:3001";
  let uiBase = process.env.MARKETING_UI_URL ?? "";
  let only = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) apiBase = argv[++i];
    else if (argv[i] === "--ui" && argv[i + 1]) uiBase = argv[++i];
    else if (argv[i] === "--id" && argv[i + 1]) only = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node scripts/capture-marketing-live.mjs [--url API] [--ui UI] [--id prompt-id]"
      );
      process.exit(0);
    }
  }
  if (!uiBase) {
    uiBase = apiBase.includes("5173") ? apiBase : "http://localhost:5173";
  }
  return { apiBase: apiBase.replace(/\/$/, ""), uiBase: uiBase.replace(/\/$/, ""), only };
}

/** @type {string | null | undefined} */
let cachedWebToken;

async function getWebAuthToken() {
  if (cachedWebToken === undefined) {
    cachedWebToken = await resolveWebAuthToken();
  }
  return cachedWebToken;
}

const API_TIMEOUT_MS = Number(process.env.MARKETING_API_TIMEOUT_MS ?? "120000");
/** Extra wall time after the frame budget to wait for turn_end (harness can outlast screenshots). */
const TURN_GRACE_MS = Number(String(process.env.MARKETING_TURN_GRACE_MS ?? "300000").replace(/_/g, ""));

async function apiJson(base, route, init = {}) {
  const token = await getWebAuthToken();
  const res = await fetch(`${base}${route}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      ...webAuthHeaders(token),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${route} → ${res.status}: ${body.error ?? text}`);
  }
  return body;
}

async function waitForServer(base) {
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    if (await probeWebApi(base)) return;
    await sleep(1500);
  }
  throw new Error(`API not reachable at ${base} (tried /api/config and /api/status with token)`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureBootstrapSkipped(apiBase) {
  const cfg = await apiJson(apiBase, "/api/config");
  if (!cfg.personaBootstrapPending) return;
  console.log("[live] Skipping persona bootstrap…");
  await apiJson(apiBase, "/api/persona/bootstrap", {
    method: "POST",
    body: JSON.stringify({ skip: true }),
  });
  await sleep(2500);
}

const REUSE_CHAT = process.env.MARKETING_REUSE_CHAT === "1";
const BATCH_CHAT_TITLE = "marketing-batch-capture";

async function createMarketingChat(apiBase, spec) {
  const body = await apiJson(apiBase, "/api/chats", {
    method: "POST",
    body: JSON.stringify({
      title: REUSE_CHAT ? BATCH_CHAT_TITLE : `marketing-${spec.id}`,
      workspaceMode: "reuse",
      workspaceRoot: REPO_ROOT,
      activate: true,
    }),
  });
  return body.meta?.chatId ?? body.meta?.id;
}

/**
 * @param {string} apiBase
 * @returns {Promise<string | null>}
 */
async function findBatchChat(apiBase) {
  const list = await apiJson(apiBase, "/api/chats");
  const chats = Array.isArray(list.chats) ? list.chats : list;
  const row = (chats ?? []).find((c) => c.title === BATCH_CHAT_TITLE);
  return row?.chatId ?? row?.id ?? null;
}

/**
 * @param {string} apiBase
 * @param {{ id: string }} spec
 * @param {string | null} batchChatId
 */
async function resolveChatForPrompt(apiBase, spec, batchChatId) {
  if (REUSE_CHAT && batchChatId) return batchChatId;
  return createMarketingChat(apiBase, spec);
}

async function waitHarnessIdle(apiBase, maxWaitMs, chatId = null) {
  const start = Date.now();
  let idleStreak = 0;
  while (Date.now() - start < maxWaitMs) {
    if (chatId) {
      const jsonl = await resolveSessionJsonlPath(chatId);
      if (jsonl && (await isLatestTurnComplete(jsonl))) {
        return { busy: false, activeChatId: chatId };
      }
    }
    try {
      const st = await apiJson(apiBase, "/api/status");
      if (chatId && st.activeChatId && st.activeChatId !== chatId) {
        idleStreak = 0;
        await sleep(1000);
        continue;
      }
      if (!st.busy) {
        idleStreak++;
        if (idleStreak >= 2) return st;
      } else {
        idleStreak = 0;
      }
    } catch {
      idleStreak = 0;
    }
    await sleep(1500);
  }
  throw new Error(
    `Harness still busy after ${maxWaitMs}ms` +
      (chatId ? ` (wanted chat ${chatId})` : "")
  );
}

/** Wait until session log shows turn_end or API reports idle (remaining wall budget). */
async function waitTurnComplete(apiBase, chatId, maxWaitMs) {
  if (maxWaitMs <= 0) {
    const jsonl = await resolveSessionJsonlPath(chatId);
    if (jsonl && (await isLatestTurnComplete(jsonl))) return;
    throw new Error(`Turn not complete and no time left (chat ${chatId})`);
  }
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const jsonl = await resolveSessionJsonlPath(chatId);
    if (jsonl && (await isLatestTurnComplete(jsonl))) return;
    try {
      const st = await apiJson(apiBase, "/api/status");
      if (st.activeChatId === chatId && !st.busy) return;
    } catch {
      /* harness may block the web thread — keep polling jsonl */
    }
    await sleep(2000);
  }
  const jsonl = await resolveSessionJsonlPath(chatId);
  if (jsonl && (await isLatestTurnComplete(jsonl))) return;
  throw new Error(
    `Turn not complete after ${maxWaitMs}ms` + (chatId ? ` (chat ${chatId})` : "")
  );
}

async function activateChat(apiBase, chatId) {
  await apiJson(apiBase, `/api/chats/${encodeURIComponent(chatId)}/activate`, {
    method: "POST",
    body: "{}",
  });
  await waitHarnessIdle(apiBase, 90_000, chatId);
}

/** Reset transcript on the active chat before each marketing prompt. */
async function prepareLiveMarketingChat(apiBase, chatId) {
  await activateChat(apiBase, chatId);
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    try {
      await apiJson(apiBase, "/api/session/reset", {
        method: "POST",
        body: JSON.stringify({ mode: "soft" }),
      });
      await waitHarnessIdle(apiBase, 60_000, chatId);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409|busy|processing/i.test(msg)) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not reset marketing chat ${chatId}`);
}

async function purgeStaleMarketingChats(apiBase) {
  const list = await apiJson(apiBase, "/api/chats");
  const chats = Array.isArray(list.chats) ? list.chats : list;
  for (const chat of chats ?? []) {
    const id = chat.chatId ?? chat.id;
    const title = chat.title ?? "";
    if (!id || (!title.startsWith("marketing-") && title !== BATCH_CHAT_TITLE)) continue;
    console.log(`[live] Removing stale marketing chat ${id} (${title})`);
    try {
      await apiJson(apiBase, `/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
  }
}

async function postMessageWhenIdle(apiBase, chatId, message, maxWaitMs = 180_000) {
  const start = Date.now();
  let waits = 0;
  while (Date.now() - start < maxWaitMs) {
    let busy = false;
    try {
      const st = await apiJson(apiBase, "/api/status");
      busy = !!st.busy;
    } catch {
      const jsonl = await resolveSessionJsonlPath(chatId);
      if (jsonl && (await isLatestTurnComplete(jsonl))) return;
      busy = true;
    }
    if (busy) {
      waits++;
      if (waits % 5 === 0) {
        console.log(`[live]   waiting for harness idle… (${Math.round((Date.now() - start) / 1000)}s)`);
      }
      await sleep(2000);
      continue;
    }
    await apiJson(apiBase, "/api/message", {
      method: "POST",
      body: JSON.stringify({ message, freshContext: true }),
    });
    return;
  }
  throw new Error(`Could not post message for ${chatId} within ${maxWaitMs}ms`);
}

async function waitUiTurnComplete(page, maxWaitMs) {
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      if (!ta) return false;
      const ph = ta.getAttribute("placeholder") ?? "";
      if (ph.toLowerCase().includes("processing")) return false;
      const text = document.body.innerText ?? "";
      const hasUser = text.includes("You") || text.toLowerCase().includes("write ");
      const hasDone =
        text.includes("done") || text.includes("✓") || text.includes("Type-checked");
      return hasUser && (hasDone || text.length > 2500);
    },
    { timeout: maxWaitMs }
  );
  await sleep(1500);
}

async function tryApproveInUi(page) {
  const authorize = page.getByRole("button", { name: /AUTHORIZE/i });
  if (await authorize.isVisible({ timeout: 400 }).catch(() => false)) {
    await authorize.click();
    console.log("[live] Clicked AUTHORIZE");
    await sleep(500);
    return true;
  }
  return false;
}

async function framesToGif(framePaths, gifPath) {
  const listFile = path.join(path.dirname(gifPath), `.frames-${path.basename(gifPath, ".gif")}.txt`);
  const content = framePaths.map((p) => `file '${p.replace(/\\/g, "/")}'\nduration 0.65`).join("\n");
  await fs.writeFile(listFile, content + "\n", "utf8");
  await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-filter_complex",
        "[0:v]fps=10,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
        "-loop",
        "0",
        gifPath,
      ],
      { stdio: "inherit" }
    );
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
  await fs.unlink(listFile).catch(() => {});
}

async function runOnePrompt({ page, apiBase, uiBase, spec, batchChatId, pageReady, status }) {
  const recDir = path.join(RECORDINGS_DIR, spec.id);
  const framesDir = path.join(recDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  console.log(`\n[live] ▶ ${spec.id}${REUSE_CHAT ? " (batch chat)" : ""}`);

  await prepMarketingWorkspace(REPO_ROOT, spec);

  const chatId = await resolveChatForPrompt(apiBase, spec, batchChatId);
  console.log(`[live]   chat ${chatId}`);
  await prepareLiveMarketingChat(apiBase, chatId);

  if (!pageReady) {
    const captureUrl = `${uiBase}/?capture=1`;
    await page.goto(captureUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitHarnessIdle(apiBase, 90_000, chatId);
    await sleep(800);
  } else {
    await waitHarnessIdle(apiBase, 90_000, chatId);
  }
  await tryApproveInUi(page);

  console.log("[live]   sending prompt…");
  await postMessageWhenIdle(apiBase, chatId, spec.prompt);
  console.log("[live]   prompt sent — capturing frames…");

  const framePaths = [];
  let i = 0;
  const frameDeadline = Date.now() + spec.maxWaitMs;
  const frameIntervalMs = Number(process.env.MARKETING_FRAME_INTERVAL_MS ?? "2000");
  let sawBusy = false;
  let apiFailStreak = 0;

  while (Date.now() < frameDeadline) {
    await tryApproveInUi(page);
    let busy = false;
    try {
      const st = await apiJson(apiBase, "/api/status");
      busy = !!st.busy;
      apiFailStreak = 0;
      if (busy) sawBusy = true;
    } catch (err) {
      apiFailStreak++;
      const jsonl = chatId ? await resolveSessionJsonlPath(chatId) : null;
      if (jsonl && (await isLatestTurnComplete(jsonl))) {
        busy = false;
        apiFailStreak = 0;
      } else if (jsonl && sawBusy) {
        // Harness blocks the web thread — keep screenshotting; session log is source of truth.
        busy = true;
        apiFailStreak = 0;
      } else if (apiFailStreak >= 15) {
        throw new Error(
          `API lost during capture (${apiFailStreak} failures): ${err instanceof Error ? err.message : err}`
        );
      } else {
        busy = sawBusy;
      }
    }

    const fp = path.join(framesDir, `f${String(i).padStart(4, "0")}.png`);
    await page.screenshot({ path: fp, type: "png" });
    framePaths.push(fp);
    i++;
    if (status && (i === 1 || i % 5 === 0)) {
      await status.promptProgress(spec.id, { frames: i, detail: busy ? "harness busy" : "idle" });
    }

    if (chatId) {
      const jsonl = await resolveSessionJsonlPath(chatId);
      if (jsonl && (await isLatestTurnComplete(jsonl))) break;
    }
    await sleep(frameIntervalMs);
  }

  const turnWaitMs = TURN_GRACE_MS + Math.max(0, frameDeadline - Date.now());
  console.log(`[live]   frame capture done (${i} frames) — waiting for turn_end (up to ${Math.round(turnWaitMs / 1000)}s)…`);
  await waitTurnComplete(apiBase, chatId, turnWaitMs);
  try {
    await waitUiTurnComplete(page, 60_000);
  } catch {
    console.warn("[live] UI idle heuristic timed out — using last frame anyway");
  }

  const heroPng = path.join(OUT_DIR, `${spec.id}.png`);
  await page.screenshot({ path: heroPng, type: "png" });
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
    console.log(`[live]   session log: ${jsonlPath} · ${meta.tools?.length ?? 0} tools`);
  } else {
    console.warn(`[live]   no session jsonl for ${chatId}`);
  }

  await fs.writeFile(
    path.join(recDir, "messages.json"),
    JSON.stringify(
      { prompt: spec.prompt, chatId, messages, meta, capturedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );

  const gifPath = path.join(OUT_DIR, `${spec.id}.gif`);
  if (framePaths.length > 1) {
    console.log(`[live]   GIF…`);
    await framesToGif(framePaths, gifPath);
  }

  if (!messages.length) {
    throw new Error(`${spec.id}: turn finished but session log has no messages — capture invalid`);
  }

  return {
    id: spec.id,
    chatId,
    pageReady: true,
    png: path.relative(REPO_ROOT, heroPng).replace(/\\/g, "/"),
    gif:
      framePaths.length > 1
        ? path.relative(REPO_ROOT, gifPath).replace(/\\/g, "/")
        : undefined,
    tools: meta.tools,
    durationMs: meta.durationMs,
    messageCount: messages.length,
    source: "live",
  };
}

async function publishWebsiteHeroes() {
  const heroMap = [
    ["live-code-ship-test.png", path.join(REPO_ROOT, "assets", "web-ui.png")],
    ["live-repo-react-trace.png", path.join(OUT_DIR, "website-repo-explore.png")],
    ["live-web-research-cite.png", path.join(OUT_DIR, "website-web-research.png")],
    ["live-memory-recall.png", path.join(OUT_DIR, "website-memory-recall.png")],
  ];
  for (const [src, dest] of heroMap) {
    const from = path.join(OUT_DIR, src);
    try {
      await fs.copyFile(from, dest);
    } catch {
      /* skip missing */
    }
  }
}

async function main() {
  const { apiBase, uiBase, only } = parseArgs(process.argv);
  const specs = only
    ? (() => {
        const spec = findPrompt(only, "live", true);
        return spec ? [spec] : [];
      })()
    : PROMPTS;
  if (!specs.length) {
    console.error(`Unknown id: ${only} (resolved: ${resolvePromptId(only ?? "", "live")})`);
    process.exit(1);
  }

  const status = new MarketingCaptureStatus({
    repoRoot: REPO_ROOT,
    channel: "live",
    promptIds: specs.map((s) => s.id),
  });
  await status.start();

  let exitCode = 0;
  try {
  console.log(`[live] API ${apiBase} · UI ${uiBase}`);
  await waitForServer(apiBase);
  await ensureMarketingModelLive(apiBase, apiJson);
  await ensureBootstrapSkipped(apiBase);
  await purgeStaleMarketingChats(apiBase);

  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark" }).then((c) =>
    c.newPage()
  );

  let batchChatId = null;
  if (REUSE_CHAT) {
    batchChatId = await findBatchChat(apiBase);
    if (!batchChatId) {
      batchChatId = await createMarketingChat(apiBase, { id: "batch" });
      console.log(`[live] batch chat ${batchChatId} (reuse for all prompts)`);
    } else {
      console.log(`[live] reusing batch chat ${batchChatId}`);
    }
  }

  const results = [];
  let pageReady = false;
  for (const spec of specs) {
    if (batchChatId && results.length > 0) {
      await waitTurnComplete(apiBase, batchChatId, 300_000).catch(() => {});
    }
    await status.promptStart(spec.id);
    try {
      const result = await runOnePrompt({
        page,
        apiBase,
        uiBase,
        spec,
        batchChatId,
        pageReady,
        status,
      });
      pageReady = result.pageReady ?? true;
      const { pageReady: _pr, ...row } = result;
      results.push(row);
      await status.promptEnd(spec.id, { ok: true, tools: result.tools });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live] FAILED ${spec.id}:`, msg);
      results.push({ id: spec.id, source: "live", error: String(err) });
      await status.promptEnd(spec.id, { ok: false, error: msg });
    }
  }

  await browser.close();
  await publishWebsiteHeroes();

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "live",
    apiBase,
    uiBase,
    ...marketingModelManifestFields(),
    results,
  };
  await fs.writeFile(path.join(OUT_DIR, "live-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("\n[live] Done → assets/marketing/live-manifest.json");
  console.log(JSON.stringify(results, null, 2));

  const failed = results.filter((r) => r.error || !r.tools?.length);
  exitCode = failed.length ? 1 : 0;
  await status.finish({
    ok: exitCode === 0,
    exitCode,
    results,
    message:
      exitCode === 0
        ? `Live capture complete (${results.length} prompt(s))`
        : `Live capture finished with ${failed.length} failure(s)`,
  });
  if (exitCode) process.exit(exitCode);
  } catch (err) {
    await status.fail(err);
    throw err;
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
