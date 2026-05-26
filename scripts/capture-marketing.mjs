#!/usr/bin/env node
/**
 * Capture Liminal marketing PNGs + GIFs from the fixture-driven marketing page.
 *
 * Prereqs: Vite dev client on :5173 (npm run web:dev) OR pass --url.
 * Usage:
 *   node scripts/capture-marketing.mjs
 *   node scripts/capture-marketing.mjs --scenario coding-typescript
 *   node scripts/capture-marketing.mjs --url http://127.0.0.1:5173
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "assets", "marketing");

/** Must match MARKETING_SCENARIOS in packages/web/client/marketing/scenarios.ts */
const SCENARIOS = [
  { id: "coding-typescript", frames: 4, gif: true },
  { id: "memory-recall", frames: 3, gif: true },
  { id: "web-research", frames: 3, gif: true },
  { id: "git-workflow", frames: 3, gif: true },
  { id: "subagents", frames: 2, gif: true },
  { id: "reasoning-plan", frames: 3, gif: true },
  { id: "approval-gate", frames: 1, gif: false },
  { id: "persona-bootstrap", frames: 1, gif: false },
  // Advanced / hard
  { id: "semantic-rename", frames: 4, gif: true },
  { id: "fix-flaky-tests", frames: 4, gif: true },
  { id: "browser-staging", frames: 3, gif: true },
  { id: "document-deck", frames: 3, gif: true },
  { id: "parallel-review", frames: 3, gif: true },
  { id: "atomic-migration", frames: 4, gif: true },
  { id: "research-synthesis", frames: 3, gif: true },
];

const ADVANCED_IDS = new Set([
  "semantic-rename",
  "fix-flaky-tests",
  "browser-staging",
  "document-deck",
  "parallel-review",
  "atomic-migration",
  "research-synthesis",
]);

const VIEWPORT = { width: 1280, height: 800 };
const FRAME_DELAY_MS = 650;

function parseArgs(argv) {
  let baseUrl = "http://localhost:5173";
  let only = null;
  let advancedOnly = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) {
      baseUrl = argv[++i];
    } else if (argv[i] === "--scenario" && argv[i + 1]) {
      only = argv[++i];
    } else if (argv[i] === "--advanced") {
      advancedOnly = true;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        `Usage: node scripts/capture-marketing.mjs [--url URL] [--scenario id] [--advanced]`
      );
      process.exit(0);
    }
  }
  return { baseUrl, only, advancedOnly };
}

async function waitForReady(page) {
  await page.waitForSelector('[data-marketing-ready="true"]', { timeout: 30_000 });
  await page.waitForTimeout(120);
}

async function screenshotFrame(page, baseUrl, scenarioId, frame, outPath) {
  const url = `${baseUrl.replace(/\/$/, "")}/marketing.html?scenario=${encodeURIComponent(scenarioId)}&frame=${frame}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForReady(page);
  await page.screenshot({ path: outPath, type: "png" });
}

async function framesToGif(framePaths, gifPath) {
  const listFile = path.join(path.dirname(gifPath), `.frames-${path.basename(gifPath, ".gif")}.txt`);
  const content = framePaths.map((p) => `file '${p.replace(/\\/g, "/")}'\nduration ${FRAME_DELAY_MS / 1000}`).join("\n");
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

async function main() {
  console.warn(
    "\n⚠  Illustrative fixtures — NOT real harness output.\n" +
      "   For accurate assets: npm run marketing:capture:live\n"
  );
  const { baseUrl, only, advancedOnly } = parseArgs(process.argv);
  let scenarios = SCENARIOS;
  if (only) scenarios = SCENARIOS.filter((s) => s.id === only);
  else if (advancedOnly) scenarios = SCENARIOS.filter((s) => ADVANCED_IDS.has(s.id));
  if (scenarios.length === 0) {
    console.error(`Unknown scenario: ${only}`);
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "frames"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const index = { generatedAt: new Date().toISOString(), baseUrl, assets: [] };

  for (const scenario of scenarios) {
    const framePaths = [];
    const lastFrame = scenario.frames - 1;
    for (let f = 0; f < scenario.frames; f++) {
      const framePath = path.join(OUT_DIR, "frames", `${scenario.id}-f${f}.png`);
      console.log(`[capture] ${scenario.id} frame ${f}/${lastFrame}`);
      await screenshotFrame(page, baseUrl, scenario.id, f, framePath);
      framePaths.push(framePath);
    }

    const heroPng = path.join(OUT_DIR, `${scenario.id}.png`);
    await fs.copyFile(framePaths[framePaths.length - 1], heroPng);
    const entry = { id: scenario.id, png: path.relative(REPO_ROOT, heroPng).replace(/\\/g, "/") };

    if (scenario.gif && framePaths.length > 1) {
      const gifPath = path.join(OUT_DIR, `${scenario.id}.gif`);
      console.log(`[gif] ${scenario.id}`);
      await framesToGif(framePaths, gifPath);
      entry.gif = path.relative(REPO_ROOT, gifPath).replace(/\\/g, "/");
    }

    index.assets.push(entry);
  }

  await browser.close();

  const indexPath = path.join(OUT_DIR, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`\nDone → ${OUT_DIR}`);
  console.log(JSON.stringify(index.assets, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
