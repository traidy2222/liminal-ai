/**
 * Headless browser tools (Playwright) — gated by AGENT_BROWSER=1.
 */
import { defineTool } from "./helpers.js";

export const browserOpenTool = defineTool({
  name: "browser_open",
  description:
    "WHAT: Open a URL in headless Chromium and return page title + visible text excerpt, with optional console/runtime diagnostics.\n" +
    "WHEN: web_fetch is blocked, you need rendered DOM, or you want browser-side confirmation checks.\n" +
    "Requires AGENT_BROWSER=1 and playwright installed.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "https URL to open" },
      wait_ms: { type: "number", description: "Extra wait after load (default 800)" },
      include_console: {
        type: "boolean",
        description: "Include browser console messages, page errors, and failed network requests",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    if (process.env["AGENT_BROWSER"] !== "1") {
      return {
        ok: false,
        error: "Set AGENT_BROWSER=1 and install playwright (npm i playwright) to enable browser_open.",
      };
    }
    const url = args["url"] as string;
    const waitMs = (args["wait_ms"] as number | undefined) ?? 800;
    const includeConsole = args["include_console"] === true;
    try {
      const pw = await import("playwright");
      const browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      const consoleMsgs: string[] = [];
      const pageErrors: string[] = [];
      const failedReqs: string[] = [];
      if (includeConsole) {
        page.on("console", (m) => {
          const line = `${m.type().toUpperCase()}: ${m.text()}`.slice(0, 300);
          consoleMsgs.push(line);
          if (consoleMsgs.length > 80) consoleMsgs.shift();
        });
        page.on("pageerror", (err) => {
          pageErrors.push(String(err).slice(0, 400));
          if (pageErrors.length > 40) pageErrors.shift();
        });
        page.on("requestfailed", (req) => {
          const failure = req.failure()?.errorText ?? "request_failed";
          failedReqs.push(`${req.method()} ${req.url()} :: ${failure}`.slice(0, 400));
          if (failedReqs.length > 60) failedReqs.shift();
        });
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise<void>((r) => setTimeout(r, waitMs));
      const title = await page.title();
      const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 12_000);
      await browser.close();
      const diagnostics = includeConsole
        ? `\nCONSOLE:\n${consoleMsgs.slice(0, 30).join("\n") || "(none)"}\n` +
          `PAGE_ERRORS:\n${pageErrors.slice(0, 20).join("\n") || "(none)"}\n` +
          `FAILED_REQUESTS:\n${failedReqs.slice(0, 20).join("\n") || "(none)"}`
        : "";
      return { ok: true, output: `TITLE: ${title}\nTEXT:\n${text}${diagnostics}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const browserActTool = defineTool({
  name: "browser_act",
  description:
    "WHAT: Open URL then run a short Playwright snippet (click/fill) described as steps, with optional console/runtime diagnostics.\n" +
    "WHEN: Simple scripted interaction after browser_open.\n" +
    "ARGS: url; steps — short natural language hint (agent uses fixed safe probes only: scroll).",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      steps: { type: "string", description: "Hint text (currently only scroll-to-bottom is implemented)" },
      include_console: {
        type: "boolean",
        description: "Include browser console messages, page errors, and failed network requests",
      },
    },
    required: ["url", "steps"],
    additionalProperties: false,
  },
  handler: async (args) => {
    if (process.env["AGENT_BROWSER"] !== "1") {
      return {
        ok: false,
        error: "Set AGENT_BROWSER=1 and install playwright to enable browser_act.",
      };
    }
    const url = args["url"] as string;
    const includeConsole = args["include_console"] === true;
    try {
      const pw = await import("playwright");
      const browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      const consoleMsgs: string[] = [];
      const pageErrors: string[] = [];
      const failedReqs: string[] = [];
      if (includeConsole) {
        page.on("console", (m) => {
          const line = `${m.type().toUpperCase()}: ${m.text()}`.slice(0, 300);
          consoleMsgs.push(line);
          if (consoleMsgs.length > 80) consoleMsgs.shift();
        });
        page.on("pageerror", (err) => {
          pageErrors.push(String(err).slice(0, 400));
          if (pageErrors.length > 40) pageErrors.shift();
        });
        page.on("requestfailed", (req) => {
          const failure = req.failure()?.errorText ?? "request_failed";
          failedReqs.push(`${req.method()} ${req.url()} :: ${failure}`.slice(0, 400));
          if (failedReqs.length > 60) failedReqs.shift();
        });
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise<void>((r) => setTimeout(r, 500));
      const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 8000);
      await browser.close();
      const diagnostics = includeConsole
        ? `\nCONSOLE:\n${consoleMsgs.slice(0, 30).join("\n") || "(none)"}\n` +
          `PAGE_ERRORS:\n${pageErrors.slice(0, 20).join("\n") || "(none)"}\n` +
          `FAILED_REQUESTS:\n${failedReqs.slice(0, 20).join("\n") || "(none)"}`
        : "";
      return { ok: true, output: `After act:\n${text}${diagnostics}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
