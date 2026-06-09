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
import { messagesFromSessionJsonl, resolveSessionJsonlPath } from "./lib/marketing-jsonl.mjs";
import { findPrompt, getMarketingPrompts, resolvePromptId } from "./lib/marketing-prompts.mjs";
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

async function apiJson(base, route, init = {}) {
  const res = await fetch(`${base}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
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
    try {
      const res = await fetch(`${base}/api/status`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  throw new Error(`API not reachable at ${base}/api/status`);
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

async function createMarketingChat(apiBase, spec) {
  const body = await apiJson(apiBase, "/api/chats", {
    method: "POST",
    body: JSON.stringify({
      title: `marketing-${spec.id}`,
      workspaceMode: "reuse",
      workspaceRoot: REPO_ROOT,
      activate: true,
    }),
  });
  return body.meta?.chatId ?? body.meta?.id;
}

async function waitHarnessIdle(apiBase, maxWaitMs, chatId = null) {
  const start = Date.now();
  let idleStreak = 0;
  while (Date.now() - start < maxWaitMs) {
    const st = await apiJson(apiBase, "/api/status");
    if (chatId && st.activeChatId !== chatId) {
      idleStreak = 0;
      await sleep(1000);
      continue;
    }
    if (!st.busy) {
      idleStreak++;
      if (idleStreak >= 3) return st;
    } else {
      idleStreak = 0;
    }
    await sleep(2000);
  }
  throw new Error(
    `Harness still busy after ${maxWaitMs}ms` +
      (chatId ? ` (wanted chat ${chatId})` : "")
  );
}

async function activateChat(apiBase, chatId) {
  await apiJson(apiBase, `/api/chats/${encodeURIComponent(chatId)}/activate`, {
    method: "POST",
    body: "{}",
  });
  await waitHarnessIdle(apiBase, 120_000, chatId);
}

async function postMessageWhenIdle(apiBase, chatId, message, maxWaitMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await activateChat(apiBase, chatId);
    try {
      await apiJson(apiBase, "/api/message", {
        method: "POST",
        body: JSON.stringify({ message, freshContext: true }),
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/409|already processing|busy/i.test(msg)) throw err;
      await sleep(2500);
    }
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

async function runOnePrompt({ page, apiBase, uiBase, spec }) {
  const recDir = path.join(RECORDINGS_DIR, spec.id);
  const framesDir = path.join(recDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  console.log(`\n[live] ▶ ${spec.id}`);

  const chatId = await createMarketingChat(apiBase, spec);
  console.log(`[live]   chat ${chatId}`);
  await activateChat(apiBase, chatId);

  const captureUrl = `${uiBase}/?capture=1`;
  await page.goto(captureUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitHarnessIdle(apiBase, 90_000, chatId);
  await sleep(800);
  await tryApproveInUi(page);

  console.log("[live]   sending prompt…");
  await postMessageWhenIdle(apiBase, chatId, spec.prompt);

  const framePaths = [];
  let i = 0;
  const pollStart = Date.now();

  while (Date.now() - pollStart < spec.maxWaitMs) {
    await tryApproveInUi(page);
    let busy = true;
    try {
      const st = await apiJson(apiBase, "/api/status");
      busy = st.busy;
    } catch {
      /* continue screenshots */
    }
    const fp = path.join(framesDir, `f${String(i).padStart(2, "0")}.png`);
    await page.screenshot({ path: fp, type: "png" });
    framePaths.push(fp);
    i++;
    if (!busy && i >= 2) break;
    await sleep(3000);
  }

  await waitHarnessIdle(apiBase, Math.min(120_000, spec.maxWaitMs), chatId);
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
    png: path.relative(REPO_ROOT, heroPng).replace(/\\/g, "/"),
    gif:
      framePaths.length > 1
        ? path.relative(REPO_ROOT, gifPath).replace(/\\/g, "/")
        : undefined,
    tools: meta.tools,
    durationMs: meta.durationMs,
    messageCount: messages.length,
    chatId,
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

  console.log(`[live] API ${apiBase} · UI ${uiBase}`);
  await waitForServer(apiBase);
  await ensureMarketingModelLive(apiBase, apiJson);
  await ensureBootstrapSkipped(apiBase);

  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark" }).then((c) =>
    c.newPage()
  );

  const results = [];
  for (const spec of specs) {
    try {
      results.push(await runOnePrompt({ page, apiBase, uiBase, spec }));
    } catch (err) {
      console.error(`[live] FAILED ${spec.id}:`, err instanceof Error ? err.message : err);
      results.push({ id: spec.id, source: "live", error: String(err) });
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
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
