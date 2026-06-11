/**
 * Playwright browser tools — session-based agentic workflow (see browser_runtime.ts).
 */
import { defineTool } from "../../shared/helpers.js";
import type { AgentHarness } from "@liminal/core";
import {
  browserEnabled,
  openBrowserSession,
  snapshotBrowserSession,
  actOnBrowserSession,
  navigateBrowserSession,
  closeBrowserSession,
  closeAllBrowserSessionsForTask,
  runOneShotBrowserAct,
  parseActionsFromArgs,
  parseHarnessMs,
  resolveBrowseHref,
  registerBrowserTurnCleanup,
  setBrowserViewPublisher,
  startStaticFileServer,
  waitForInSession,
  extractFromSession,
  getSessionCookies,
  addSessionCookies,
  clearSessionCookies,
  saveCookieProfile,
  loadCookieProfile,
  listCookieProfiles,
  type BrowserActOp,
  type WaitUntilNav,
  type ExtractType,
} from "./browser_runtime.js";
import path from "node:path";
import fs from "node:fs";
import { resolveWorkspaceRoot } from "@liminal/core";

function browserGate(): { ok: true } | { ok: false; error: string } {
  if (!browserEnabled()) {
    return {
      ok: false,
      error:
        "Set AGENT_BROWSER=1 and run `npm run browser:install` (or `npx playwright install chromium` in packages/tools) to enable browser tools.",
    };
  }
  return { ok: true };
}

function parseWaitUntil(raw: unknown): WaitUntilNav | { error: string } {
  const w = (raw as WaitUntilNav | undefined) ?? "domcontentloaded";
  if (w === "domcontentloaded" || w === "load" || w === "networkidle") return w;
  return { error: "wait_until ∈ domcontentloaded | load | networkidle" };
}

function visionHintLine(): string {
  return "\n[Hint] For layout checks: activate_tool_family vision if needed, then vision_analyze with image=<SCREENSHOT_PATH> and a concrete prompt.\n";
}

export const browserOpenTool = defineTool({
  name: "browser_open",
  description:
    "WHAT: Open URL in Chromium and keep a persistent session (returns session_id).\n" +
    "Returns SNAPSHOT_REFS (e1, e2, …) for click_ref/fill_ref/hover_ref, body excerpt, optional console diagnostics.\n" +
    "WHEN: First step of browser verification — then browser_act(session_id) / browser_snapshot without re-navigating.\n" +
    "Close with browser_close when done. file:// allowed under workspace or AGENT_BROWSER_FILE_ROOT.\n" +
    "Requires AGENT_BROWSER=1.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s):// or file:/// URL" },
      wait_ms: { type: "number", description: "Idle wait after navigation (0–30000, default 800)" },
      wait_until: {
        type: "string",
        enum: ["domcontentloaded", "load", "networkidle"],
      },
      navigation_timeout_ms: { type: "number" },
      viewport_width: { type: "number" },
      viewport_height: { type: "number" },
      include_console: { type: "boolean", description: "Recommended for local HTML/JS" },
      include_snapshot: {
        type: "boolean",
        description: "Emit SNAPSHOT_REFS (default true when omitted — pass false to skip)",
      },
      screenshot: { type: "boolean", description: "Save PNG under .agent_artifacts/browser/" },
      user_agent: { type: "string", description: "Override the browser User-Agent string for this session (e.g. to test mobile or bot-wall bypass)" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args, _emit, harness?: AgentHarness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    if (args["session_id"] !== undefined && args["session_id"] !== null && String(args["session_id"]).trim()) {
      return {
        ok: false,
        error:
          "browser_open always starts a new session. To change URL, use browser_navigate or browser_act with { op: 'goto', url: '...' }.",
      };
    }
    const resolved = resolveBrowseHref(args["url"] as string);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const wu = parseWaitUntil(args["wait_until"]);
    if (typeof wu === "object" && wu !== null && "error" in wu) return { ok: false, error: wu.error };

    const taskId = harness?.taskId ?? "anonymous";
    const waitMs = Math.min(30_000, Math.max(0, Number(args["wait_ms"] ?? 800) || 0));
    const includeConsole = args["include_console"] !== false;
    const includeSnapshot = args["include_snapshot"] !== false;
    const navTimeoutMs = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);

    let viewport: { width: number; height: number } | undefined;
    const vw = args["viewport_width"] as number | undefined;
    const vh = args["viewport_height"] as number | undefined;
    if (vw !== undefined && vh !== undefined && Number.isFinite(vw) && Number.isFinite(vh)) {
      viewport = {
        width: Math.round(Math.min(1920, Math.max(320, vw))),
        height: Math.round(Math.min(1080, Math.max(240, vh))),
      };
    }

    const opened = await openBrowserSession({
      ownerTaskId: taskId,
      href: resolved.href,
      waitUntil: wu,
      navTimeoutMs,
      postWaitMs: waitMs,
      viewport,
      userAgent: args["user_agent"] as string | undefined,
      includeConsole,
      includeSnapshot,
      screenshot: args["screenshot"] === true,
    });
    if (!opened.ok) return opened;

    return { ok: true, output: opened.output + visionHintLine() };
  },
});

export const browserSnapshotTool = defineTool({
  name: "browser_snapshot",
  description:
    "WHAT: Refresh SNAPSHOT_REFS and page diagnostics for an existing browser session.\n" +
    "WHEN: After browser_act changes the DOM — re-read refs before click_ref/fill_ref.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "From browser_open" },
      include_console: { type: "boolean" },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const includeConsole = args["include_console"] !== false;
    return snapshotBrowserSession(sessionId, includeConsole);
  },
});

export const browserNavigateTool = defineTool({
  name: "browser_navigate",
  description:
    "WHAT: Navigate an existing browser session to a new URL (same session_id, keeps cookies).\n" +
    "WHEN: Change page without browser_close + browser_open. Alternative: browser_act goto op.\n" +
    "Returns fresh SNAPSHOT_REFS after navigation.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      url: { type: "string" },
      wait_ms: { type: "number", description: "Idle wait after navigation (0–30000)" },
      wait_until: {
        type: "string",
        enum: ["domcontentloaded", "load", "networkidle"],
      },
      navigation_timeout_ms: { type: "number" },
      include_console: { type: "boolean" },
      screenshot: { type: "boolean", description: "Save PNG under .agent_artifacts/browser/ after navigation" },
    },
    required: ["session_id", "url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const resolved = resolveBrowseHref(String(args["url"] ?? ""));
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const wu = parseWaitUntil(args["wait_until"]);
    if (typeof wu === "object" && wu !== null && "error" in wu) return { ok: false, error: wu.error };
    const waitMs = Math.min(30_000, Math.max(0, Number(args["wait_ms"] ?? 0) || 0));
    const navTimeoutMs = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);
    const res = await navigateBrowserSession({
      sessionId,
      href: resolved.href,
      waitUntil: wu,
      navTimeoutMs,
      postWaitMs: waitMs,
      includeConsole: args["include_console"] !== false,
      screenshot: args["screenshot"] === true,
    });
    if (!res.ok) return res;
    return { ok: true, output: res.output + visionHintLine() };
  },
});

export const browserActTool = defineTool({
  name: "browser_act",
  description:
    "WHAT: Run structured actions on a page (session_id preferred) or one-shot on url.\n" +
    "Ops: goto, wait_ms, scroll, click_ref, fill_ref, focus_ref, clear_ref, type_ref, press_key_ref, press_key, click_selector (selector field), wait_navigation, screenshot, …\n" +
    "Examples: { op:'goto', url:'https://news.ycombinator.com/ask' }; { op:'type_ref', ref:'e2', value:'query' }; { op:'press_key', key:'Enter' }.\n" +
    "Forms (JS validation): focus_ref → clear_ref → type_ref → click_ref or press_key Enter. Prefer type_ref over many press_key chars.\n" +
    "refresh_snapshot defaults true; auto-refreshes when URL changes.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Persistent session from browser_open" },
      url: { type: "string", description: "One-shot mode — launch, goto, act, close" },
      actions: {
        type: "array",
        description: "Array of { op, ... } objects (max 40)",
        items: { type: "object" },
      },
      steps: { type: "string", description: "Legacy shorthand (scroll bottom, etc.)" },
      wait_ms: { type: "number", description: "Post-action idle wait (0–30000)" },
      wait_until: {
        type: "string",
        enum: ["domcontentloaded", "load", "networkidle"],
      },
      navigation_timeout_ms: { type: "number" },
      include_console: { type: "boolean" },
      refresh_snapshot: {
        type: "boolean",
        description: "Re-emit SNAPSHOT_REFS after actions (default true; pass false to skip)",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;

    const parsed = parseActionsFromArgs(args["actions"], args["steps"]);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: parsed.error };
    }
    const actions: BrowserActOp[] = parsed;

    const includeConsole = args["include_console"] !== false;
    const refreshSnapshot = args["refresh_snapshot"] !== false;

    const sessionId = String(args["session_id"] ?? "").trim();
    if (sessionId) {
      const sessionPostWait = Math.min(
        30_000,
        Math.max(0, Number(args["wait_ms"] ?? 0) || 0)
      );
      const res = await actOnBrowserSession({
        sessionId,
        actions,
        postActionWaitMs: sessionPostWait,
        refreshSnapshot,
        includeConsole,
      });
      if (!res.ok) return res;
      return { ok: true, output: res.output + visionHintLine() };
    }

    const urlRaw = String(args["url"] ?? "").trim();
    if (!urlRaw) {
      return {
        ok: false,
        error: "Provide session_id (preferred) or url for one-shot browser_act.",
      };
    }
    const resolved = resolveBrowseHref(urlRaw);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const wu = parseWaitUntil(args["wait_until"]);
    if (typeof wu === "object" && wu !== null && "error" in wu) return { ok: false, error: wu.error };
    const navTimeoutMs = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);
    const postWaitMs = Math.min(30_000, Math.max(0, Number(args["wait_ms"] ?? 400) || 0));

    return runOneShotBrowserAct({
      href: resolved.href,
      waitUntil: wu,
      navTimeoutMs,
      actions,
      postActionWaitMs: postWaitMs,
      includeConsole,
    });
  },
});

export const browserCloseTool = defineTool({
  name: "browser_close",
  description:
    "WHAT: Tear down browser session(s) from browser_open.\n" +
    "WHEN: Before opening another page if you hit session limit, or at end of browser verification.\n" +
    "Use close_all:true to close every session for this task.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Session from browser_open (omit when close_all:true)" },
      close_all: { type: "boolean", description: "Close all browser sessions for this task" },
      screenshot: { type: "boolean", description: "Capture PNG before close (single session only)" },
    },
    additionalProperties: false,
  },
  handler: async (args, _emit, harness?: AgentHarness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;

    if (args["close_all"] === true) {
      const n = await closeAllBrowserSessionsForTask(harness?.taskId ?? "anonymous");
      return {
        ok: true,
        output: `SESSIONS_CLOSED: ${n} session(s) for this task.`,
      };
    }

    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) {
      return {
        ok: false,
        error: "Provide session_id or close_all:true.",
      };
    }
    const res = await closeBrowserSession({
      sessionId,
      screenshot: args["screenshot"] === true,
    });
    if (!res.ok) return res;
    return { ok: true, output: res.output + visionHintLine() };
  },
});

export const browserServeFileTool = defineTool({
  name: "browser_serve_file",
  description:
    "WHAT: Start a static HTTP server for a workspace HTML file and return http://127.0.0.1 URL.\n" +
    "WHEN: Local HTML with modules/assets — prefer over file:// to avoid CORS/module edge cases.\n" +
    "Server stops at turn_end. Then browser_open the SERVE_URL with include_console:true.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path under workspace root (e.g. dist/index.html)",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args, _emit, harness?: AgentHarness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;

    const rel = String(args["path"] ?? "").trim();
    if (!rel) return { ok: false, error: "path is required" };
    const ws = resolveWorkspaceRoot();
    const abs = path.resolve(ws, rel);
    if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${abs}` };
    const rootDir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    const entryFile = fs.statSync(abs).isDirectory() ? undefined : path.basename(abs);

    const started = await startStaticFileServer({
      ownerTaskId: harness?.taskId ?? "anonymous",
      rootDir,
      entryFile,
    });
    if (!started.ok) return started;

    return {
      ok: true,
      output:
        `SERVE_URL: ${started.url}\n(Directory: ${rootDir})\n` +
        "Next: browser_open on SERVE_URL with include_console:true. browser_close when done.",
    };
  },
});

/** Wire harness turn_end → close browser sessions + static servers for this task. */
export function wireBrowserHarnessCleanup(harness: AgentHarness): void {
  registerBrowserTurnCleanup(harness);
  setBrowserViewPublisher((payload) => {
    harness.emitter.emit("browser_view", {
      ...payload,
      chatId: harness.taskId,
    });
  }, harness.taskId);
}

export const browserWaitForTool = defineTool({
  name: "browser_wait_for",
  description:
    "WHAT: Wait for a condition on an existing browser session before continuing.\n" +
    "Conditions: selector (element visible), selector_hidden, text (text present), url_contains (URL changed), network_idle.\n" +
    "WHEN: After browser_act triggers an async action (form submit, SPA navigation) — wait before reading snapshot.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "From browser_open" },
      condition: {
        type: "string",
        enum: ["selector", "selector_hidden", "text", "url_contains", "network_idle"],
        description: "What to wait for",
      },
      selector: { type: "string", description: "CSS selector (required for selector / selector_hidden)" },
      text: { type: "string", description: "Text string to wait for on page (required for text)" },
      url_pattern: { type: "string", description: "Substring that the URL must contain (required for url_contains)" },
      timeout_ms: { type: "number", description: "Max wait in ms (default 15000, max 120000)" },
    },
    required: ["session_id", "condition"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const condition = String(args["condition"] ?? "") as Parameters<typeof waitForInSession>[1]["condition"];
    const allowed = ["selector", "selector_hidden", "text", "url_contains", "network_idle"];
    if (!allowed.includes(condition)) {
      return { ok: false, error: `condition must be one of: ${allowed.join(", ")}` };
    }
    return waitForInSession(sessionId, {
      condition,
      selector: args["selector"] as string | undefined,
      text: args["text"] as string | undefined,
      urlPattern: args["url_pattern"] as string | undefined,
      timeoutMs: args["timeout_ms"] as number | undefined,
    });
  },
});

export const browserExtractTool = defineTool({
  name: "browser_extract",
  description:
    "WHAT: Extract structured data from the current browser session without reading raw HTML.\n" +
    "Types: tables (→ JSON array), links (→ href+text), text (→ cleaned body text), forms (→ field schema),\n" +
    "selector_text / selector_html (→ matched elements), meta (→ title/desc/canonical), headings (→ h1-h6 list).\n" +
    "WHEN: Need machine-readable content — avoids manually parsing snapshot text.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "From browser_open" },
      type: {
        type: "string",
        enum: ["tables", "links", "text", "forms", "selector_text", "selector_html", "meta", "headings"],
        description: "What to extract",
      },
      selector: {
        type: "string",
        description: "CSS selector (required for selector_text / selector_html; optional scope for text)",
      },
      include_hidden: {
        type: "boolean",
        description: "Include hidden elements (default false)",
      },
    },
    required: ["session_id", "type"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const type = String(args["type"] ?? "") as ExtractType;
    const allowed: ExtractType[] = ["tables", "links", "text", "forms", "selector_text", "selector_html", "meta", "headings"];
    if (!allowed.includes(type)) {
      return { ok: false, error: `type must be one of: ${allowed.join(", ")}` };
    }
    if ((type === "selector_text" || type === "selector_html") && !args["selector"]) {
      return { ok: false, error: `selector is required for type=${type}` };
    }
    return extractFromSession(
      sessionId,
      type,
      args["selector"] as string | undefined,
      args["include_hidden"] === true
    );
  },
});

export const browserCookiesTool = defineTool({
  name: "browser_cookies",
  description:
    "WHAT: Manage cookies for a browser session.\n" +
    "Actions: get (return current cookies as JSON), set (inject cookies array), clear (wipe all cookies),\n" +
    "save (persist to named profile on disk), load (restore from named profile).\n" +
    "WHEN: Reuse login sessions across browser_open calls, share auth between tasks.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "From browser_open" },
      action: {
        type: "string",
        enum: ["get", "set", "clear", "save", "load", "list_profiles"],
        description: "Cookie action",
      },
      profile: {
        type: "string",
        description: "Named cookie profile for save/load (stored in .agent_artifacts/browser_cookies/)",
      },
      cookies: {
        type: "array",
        description: "Cookie objects for action=set (name, value, domain, path, expires?, httpOnly?, secure?, sameSite?)",
        items: { type: "object" },
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const action = String(args["action"] ?? "");
    const sessionId = String(args["session_id"] ?? "").trim();
    const profile = String(args["profile"] ?? "default").trim() || "default";

    if (action === "list_profiles") {
      const profiles = listCookieProfiles();
      return {
        ok: true,
        output: profiles.length
          ? `COOKIE_PROFILES:\n${profiles.map((p) => `  ${p}`).join("\n")}`
          : "COOKIE_PROFILES: (none saved yet)",
      };
    }

    if (!sessionId) return { ok: false, error: "session_id is required for action=" + action };

    switch (action) {
      case "get":
        return getSessionCookies(sessionId);
      case "set": {
        const cookies = args["cookies"];
        if (!Array.isArray(cookies) || cookies.length === 0) {
          return { ok: false, error: "cookies array is required and must not be empty for action=set" };
        }
        return addSessionCookies(sessionId, cookies);
      }
      case "clear":
        return clearSessionCookies(sessionId);
      case "save":
        return saveCookieProfile(sessionId, profile);
      case "load":
        return loadCookieProfile(sessionId, profile);
      default:
        return { ok: false, error: `Unknown action "${action}". Use: get, set, clear, save, load, list_profiles` };
    }
  },
});
