/**
 * Headless browser tools (Playwright) — gated by AGENT_BROWSER=1.
 */
import { defineTool } from "./helpers.js";

/** Playwright console + pageerror payloads (playwright may not be installed at typecheck time). */
type PwConsoleMessage = {
  type(): string;
  text(): string;
  location(): { url?: string; lineNumber: number; columnNumber: number };
};

type PwPage = {
  on(
    event: "console",
    listener: (msg: PwConsoleMessage) => void
  ): PwPage;
  on(event: "pageerror", listener: (err: Error) => void): PwPage;
  on(
    event: "requestfailed",
    listener: (req: {
      method(): string;
      url(): string;
      failure(): { errorText: string } | null;
    }) => void
  ): PwPage;
};

function formatConsoleLine(msg: PwConsoleMessage, maxLen = 420): string {
  const kind = msg.type().toUpperCase();
  const text = msg.text().trim();
  let loc = "";
  try {
    const l = msg.location();
    if (l?.url && typeof l.lineNumber === "number") {
      const col = typeof l.columnNumber === "number" ? l.columnNumber : 0;
      loc = ` @ ${l.url}:${l.lineNumber}:${col}`;
    } else if (typeof l?.lineNumber === "number" && l.lineNumber > 0) {
      const col = typeof l.columnNumber === "number" ? l.columnNumber : 0;
      loc = ` @ line ${l.lineNumber}:${col}`;
    }
  } catch {
    /* location optional */
  }
  const base = `${kind}: ${text}${loc}`;
  return base.length > maxLen ? base.slice(0, maxLen) + "…" : base;
}

/** Prefer stack (file:line) over message-only for uncaught page errors. */
function formatPageError(err: unknown, maxLen = 2000): string {
  if (err instanceof Error) {
    const s = (err.stack && err.stack.trim().length > 0 ? err.stack : err.message).trim();
    return s.length > maxLen ? s.slice(0, maxLen) + "\n…(truncated)" : s;
  }
  const s = String(err).trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

type DiagnosticBuffers = {
  consoleMsgs: string[];
  pageErrors: string[];
  failedReqs: string[];
};

function attachPlaywrightDiagnostics(page: PwPage, b: DiagnosticBuffers): void {
  page.on("console", (m) => {
    b.consoleMsgs.push(formatConsoleLine(m));
    if (b.consoleMsgs.length > 80) b.consoleMsgs.shift();
  });
  page.on("pageerror", (err) => {
    b.pageErrors.push(formatPageError(err));
    if (b.pageErrors.length > 25) b.pageErrors.shift();
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "request_failed";
    b.failedReqs.push(`${req.method()} ${req.url()} :: ${failure}`.slice(0, 400));
    if (b.failedReqs.length > 60) b.failedReqs.shift();
  });
}

function formatDiagnosticsOutput(b: DiagnosticBuffers): string {
  const con = b.consoleMsgs.slice(0, 30).join("\n") || "(none)";
  const pe = b.pageErrors.length
    ? b.pageErrors.slice(0, 12).join("\n\n--- page error ---\n\n")
    : "(none)";
  const fr = b.failedReqs.slice(0, 20).join("\n") || "(none)";
  return `\nCONSOLE (with source locations when provided by the browser):\n${con}\n` +
    `PAGE_ERRORS (stack traces when available):\n${pe}\n` +
    `FAILED_REQUESTS:\n${fr}`;
}

export const browserOpenTool = defineTool({
  name: "browser_open",
  description:
    "WHAT: Open a URL in headless Chromium and return page title + visible text excerpt, with optional console/runtime diagnostics.\n" +
    "WHEN: web_fetch is blocked, you need rendered DOM, or you want browser-side confirmation checks.\n" +
    "With include_console: console lines include URL:line:column when Chromium provides them; PAGE_ERRORS include full stack traces when available.\n" +
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
        description:
          "Include console (with source locations when reported), page errors (stack traces), and failed network requests",
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
      const buffers: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
      if (includeConsole) {
        attachPlaywrightDiagnostics(page as unknown as PwPage, buffers);
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise<void>((r) => setTimeout(r, waitMs));
      const title = await page.title();
      const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 12_000);
      await browser.close();
      const diagnostics = includeConsole ? formatDiagnosticsOutput(buffers) : "";
      return { ok: true, output: `TITLE: ${title}\nTEXT:\n${text}${diagnostics}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const browserActTool = defineTool({
  name: "browser_act",
  description:
    "WHAT: Open URL then run a short Playwright snippet (click/fill) described as steps, with optional console/runtime diagnostics (locations + error stacks when include_console).\n" +
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
        description:
          "Include console (with source locations when reported), page errors (stack traces), and failed network requests",
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
      const buffers: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
      if (includeConsole) {
        attachPlaywrightDiagnostics(page as unknown as PwPage, buffers);
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise<void>((r) => setTimeout(r, 500));
      const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 8000);
      await browser.close();
      const diagnostics = includeConsole ? formatDiagnosticsOutput(buffers) : "";
      return { ok: true, output: `After act:\n${text}${diagnostics}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
