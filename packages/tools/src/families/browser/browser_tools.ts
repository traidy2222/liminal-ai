/**
 * Playwright browser tools — session-based agentic workflow (see browser_runtime.ts).
 */
import { defineTool } from "../../shared/helpers.js";
import type { AgentHarness, PropertySchema } from "@liminal/core";
import {
  browserEnabled,
  browserWorkspaceState,
  getBrowserSession,
  ensureBrowserSessionActive,
  selectBrowserTaskTab,
  checkBrowserSessionOwner,
  browserCredentialAction,
  openBrowserSession,
  snapshotBrowserSession,
  actOnBrowserSession,
  navigateBrowserSession,
  closeBrowserSession,
  closeAllBrowserSessionsForTask,
  parseActionsFromArgs,
  parseHarnessMs,
  resolveBrowseHref,
  registerBrowserTurnCleanup,
  setBrowserViewPublisher,
  collectBrowserDiagnosticsForTask,
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
import { findingsForTask, type BrowserFindingInput } from "./browser_findings.js";
import {withBrowserTask} from './browser_queue.js';

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
    "Returns SNAPSHOT_REFS (e1, e2, …), READABLE_CONTENT from the rendered page and optional console diagnostics.\n" +
    "Use for web search, reading and interaction; search via a search-engine page, then follow result links in the same tab. Continue with browser_act / browser_snapshot without reopening.\n" +
    "Tabs and their signed-in profile survive chat turns. Use browser_tabs before opening duplicates; close only tabs you no longer need. file:// allowed under workspace or AGENT_BROWSER_FILE_ROOT.\n" +
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
      include_console: { type: "boolean", description: "Opt in to console/network diagnostics for debugging (default false)" },
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
    const includeConsole = args["include_console"] === true;
    const includeSnapshot = args["include_snapshot"] !== false;
    const navTimeoutMs = typeof args.navigation_timeout_ms==='number'?Math.max(1000,Math.min(120000,args.navigation_timeout_ms)):parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);

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

    return { ok: true, output: opened.output + (opened.output.includes('SCREENSHOT_PATH:')?visionHintLine():'') };
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
      session_id: { type: "string", description: "Optional tab handle; defaults to this task's focused tab" },
      include_console: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const includeConsole = args["include_console"] === true;
    return snapshotBrowserSession(sessionId, includeConsole);
  },
});

export const browserNavigateTool = defineTool({
  name: "browser_navigate",
  description:
    "WHAT: Navigate an existing browser session to a new URL (same session_id, keeps cookies).\n" +
    "WHEN: Change page without browser_close + browser_open. Alternative: browser_act goto op.\n" +
    "Returns fresh SNAPSHOT_REFS and READABLE_CONTENT after navigation. Follow observed destinations; use browser_search when the exact source URL is unknown instead of guessing article IDs or paths.",
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
    required: ["url"],
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
    const navTimeoutMs = typeof args.navigation_timeout_ms==='number'?Math.max(1000,Math.min(120000,args.navigation_timeout_ms)):parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);
    const res = await navigateBrowserSession({
      sessionId,
      href: resolved.href,
      waitUntil: wu,
      navTimeoutMs,
      postWaitMs: waitMs,
      includeConsole: args["include_console"] === true,
      screenshot: args["screenshot"] === true,
    });
    if (!res.ok) return res;
    return { ok: true, output: res.output + (res.output.includes('SCREENSHOT_PATH:')?visionHintLine():'') };
  },
});

const actionObject = (ops: string[], required: string[], properties: Record<string, PropertySchema>): PropertySchema => ({
  type: "object", properties: {op: {type: "string", enum: ops}, ...properties}, required: ["op", ...required], additionalProperties: false,
});
const ref = {type: "string", description: "An e-number identifying the live control in the snapshot"} as const;
const value = {type: "string"} as const;
const selector = {type: "string"} as const;
const timeout_ms = {type: "number"} as const;
export const BROWSER_ACTION_SCHEMA: PropertySchema = { anyOf: [
  actionObject(["reload"], [], {wait_until:{type:"string",enum:["load","domcontentloaded"]},timeout_ms}),
  actionObject(["wait_ms"], ["ms"], {ms: {type: "number", minimum: 0, maximum: 120000}}),
  actionObject(["fill_ref", "type_ref", "select_option_ref"], ["ref", "value"], {ref, value, timeout_ms, delay_ms: {type: "number"}}),
  actionObject(["click_ref", "double_click_ref", "check_ref", "uncheck_ref", "focus_ref", "clear_ref", "hover_ref"], ["ref"], {ref, timeout_ms}),
  actionObject(["press_key"], ["key"], {key: {type: "string"}}),
  actionObject(["press_key_ref"], ["ref", "key"], {ref, key: {type: "string"}, timeout_ms}),
  actionObject(["fill", "select_option"], ["selector", "value"], {selector, value, timeout_ms}),
  actionObject(["click_selector", "hover", "check", "uncheck"], ["selector"], {selector, timeout_ms}),
  actionObject(["goto"], ["url"], {url: {type: "string"}, wait_until: {type: "string", enum: ["load", "domcontentloaded", "networkidle"]}, timeout_ms}),
  actionObject(["click_role"], ["role", "name"], {role: {type: "string"}, name: {type: "string"}, exact: {type: "boolean"}, timeout_ms}),
  actionObject(["click_text", "double_click_text"], ["text"], {text: {type: "string"}, exact: {type: "boolean"}, timeout_ms}),
  actionObject(["scroll"], ["direction"], {direction: {type: "string", enum: ["top", "bottom", "up", "down"]}, px: {type: "number"}}),
  actionObject(["wait_selector"], ["selector"], {selector, state: {type: "string", enum: ["visible", "attached"]}, timeout_ms}),
  actionObject(["wait_navigation"], [], {wait_until: {type: "string", enum: ["load", "domcontentloaded", "networkidle"]}, timeout_ms}),
  actionObject(["screenshot"], [], {full_page: {type: "boolean"}}),
] };

export const browserActTool = defineTool({
  name: "browser_act",
  description:
    "WHAT: Run structured actions on a shared browser tab (session_id preferred), or open a new tab with url.\n" +
    "Ops: reload (refresh the current tab and preserve its URL), double_click_ref / double_click_text (native double-click, e.g. inline editing), select_option_ref (native or custom dropdown; value is its option label), goto, wait_ms, scroll, click_ref, fill_ref, focus_ref, clear_ref, type_ref, press_key_ref, press_key, click_selector (selector field), wait_navigation, screenshot, …\n" +
    "Examples: { op:'goto', url:'https://news.ycombinator.com/ask' }; { op:'type_ref', ref:'e2', value:'query' }; { op:'press_key', key:'Enter' }.\n" +
    "fill_ref replaces a field value; use type_ref when key-by-key events are needed. check_ref/uncheck_ref set checkbox state idempotently. SNAPSHOT_REFS include row context, focus, values, validation and checked state.\n" +
    "Same-page actions return changed controls/content; reuse unchanged refs. full_snapshot=true returns a full view. An executed click is not proof of success. Failures return fresh refs and candidate destinations; retry only unfinished steps. refresh_snapshot=false omits page content; with only session_id, observes the full current page.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Optional tab handle; defaults to this task's focused tab" },
      url: { type: "string", description: "Open a new tab in the shared profile, then perform actions. Prefer reusing session_id." },
      actions: {
        type: "array",
        description: "Array of { op, ... } objects (max 40)",
        items: BROWSER_ACTION_SCHEMA,
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
      full_snapshot: {type:"boolean",description:"Return the full page after actions instead of changes only (default false)"},
    },
    additionalProperties: false,
  },
  handler: async (args, _emit, harness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;

    if(args.actions===undefined&&args.steps===undefined&&args.session_id){
      return snapshotBrowserSession(String(args.session_id),args.include_console===true);
    }
    const parsed = parseActionsFromArgs(args["actions"], args["steps"]);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: parsed.error };
    }
    const actions: BrowserActOp[] = parsed;

    const includeConsole = args["include_console"] === true;
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
        compactObservation: args.full_snapshot !== true,
      });
      if (!res.ok) return res;
      return { ok: true, output: res.output + (res.output.includes('SCREENSHOT_PATH:')?visionHintLine():'') };
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

    const opened = await openBrowserSession({
      ownerTaskId: harness?.taskId ?? "anonymous", postWaitMs: 0, includeSnapshot: true,
      href: resolved.href,
      waitUntil: wu,
      navTimeoutMs,
      includeConsole,
    });
    if (!opened.ok) return opened;
    return actOnBrowserSession({
      sessionId: opened.sessionId,
      actions,
      postActionWaitMs: postWaitMs,
      includeConsole,
      refreshSnapshot,
      compactObservation: args.full_snapshot !== true,
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

/** Publish app-owned browser tabs to the originating chat. */
export function wireBrowserHarnessCleanup(harness: AgentHarness): void {
  registerBrowserTurnCleanup(harness);
  harness.onCollectBrowserDiagnostics = (taskId) => collectBrowserDiagnosticsForTask(taskId);
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
      session_id: { type: "string", description: "Optional tab handle; defaults to this task's focused tab" },
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
    required: ["condition"],
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

const focusedTaskTabs=new WeakMap<AgentHarness,string>();
const modelSessionId=(id:string)=>'tab-'+id.replace(/[^a-z0-9]/gi,'').slice(0,8);
const modelSessionResult=(result: Awaited<ReturnType<typeof browserOpenTool.handler>>,harness?:AgentHarness)=>{
  if(!harness)return result;
  const replace=(text:string)=>text.replace(/SESSION_ID: ([^\s]+)/g,(_all,id:string)=>'SESSION_ID: '+modelSessionId(id));
  return result.ok?{...result,output:replace(result.output)}:{...result,error:replace(result.error)};
};
const openHandler=browserOpenTool.handler;
browserOpenTool.handler=async(args,emit,harness,context)=>{
  const result=await openHandler(args,emit,harness,context);
  if(result.ok&&harness){const id=result.output.match(/SESSION_ID: ([^\s]+)/)?.[1];if(id)focusedTaskTabs.set(harness,id);}
  return modelSessionResult(result,harness);
};

export const browserTabsTool = defineTool({
  name: "browser_tabs",
  description: "List your existing browser tabs and user-opened tabs, with session_id, URL and user-takeover status. Reuse a suitable tab rather than reopening it; browser_navigate changes its URL. Never automate a paused tab until the user resumes it.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  requiresApproval: false,
  handler: async (_args, _emit, harness) => {
    const gate = browserGate(); if (!gate.ok) return gate;
    const task = harness?.taskId ?? "anonymous";
    const state = browserWorkspaceState(task);
    return { ok: true, output: JSON.stringify({ profile: "default", selectedTabId: state.selectedTabId && harness ? modelSessionId(state.selectedTabId) : state.selectedTabId, tabs: state.tabs.map(t=>({session_id:harness?modelSessionId(t.sessionId):t.sessionId,title:t.title,url:t.url,paused:t.paused,suspended:t.suspended})) }) };
  },
});

export function googleSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search"); url.searchParams.set("q", query.trim()); return url.href;
}

export const browserSearchTool = defineTool({
  name: "browser_search",
  description: "Search Google in this chat's browser tab and return observed results. Refine the query around the missing fact; quoted phrases, site:, after: and before: are supported. Results are leads: follow relevant links to original dated documents and read the relevant sections. Reuses the selected tab and shared login profile; no separate search API or HTTP fetch.",
  requiresApproval: true, dangerLevel: "cautious",
  parameters: { type: "object", properties: {
    query: { type: "string", minLength: 1, maxLength: 2000 },
    session_id: { type: "string", description: "Optional tab; otherwise reuse this chat's selected tab or open one" },
  }, required: ["query"], additionalProperties: false },
  handler: async (args, emit, harness, context) => {
    const query = String(args.query ?? "").trim();
    if (!query || query.length > 2000) return {ok:false,error:"query must contain 1–2000 characters"};
    harness?.registry?.activateFamilies(['browser']);
    const url = googleSearchUrl(query);
    const selected = args.session_id || (harness ? browserWorkspaceState(harness.taskId).selectedTabId : undefined);
    return selected
      ? browserNavigateTool.handler({session_id:selected,url,wait_until:"domcontentloaded",navigation_timeout_ms:20000,include_console:false},emit,harness,context)
      : browserOpenTool.handler({url,wait_until:"domcontentloaded",navigation_timeout_ms:20000,include_console:false},emit,harness,context);
  },
});

export const browserCredentialsTool = defineTool({
  name: "browser_credentials",
  description: "Prepare a cryptographically generated password in Liminal's encrypted local credential store, or autofill a saved login on its exact HTTPS origin. Passwords never appear in tool arguments/results. prepare needs username and returns credential_id as login.id; fill needs credential_id and fresh password_ref (optional username_ref/confirm_password_ref). list returns saved login metadata for this site. Preparing/filling is not proof an account was created; submit normally and verify the resulting page.",
  requiresApproval: false, dangerLevel: "cautious",
  parameters: { type: "object", properties: {
    action: {type: "string", enum: ["prepare", "fill", "list"]}, session_id: {type: "string"},
    username: {type: "string"}, credential_id: {type: "string"}, username_ref: {type: "string"},
    password_ref: {type: "string", description: "e-number for Password from the latest SNAPSHOT_REFS, e.g. e1"}, confirm_password_ref: {type: "string", description: "e-number for Confirm password, e.g. e2"},
  }, required: ["action", "session_id"], additionalProperties: false },
  handler: async args => { const gate = browserGate(); return gate.ok ? browserCredentialAction(args) : gate; },
});


export const browserExtractTool = defineTool({
  name: "browser_extract",
  description:
    "WHAT: Extract structured data from the current browser session without reading raw HTML.\n" +
    "Types: tables (→ JSON array), links (→ href+text), text (→ cleaned body text), forms (→ field schema, including inputs outside forms, open shadow roots and visible embedded frames),\n" +
    "selector_text / selector_html (→ matched elements), meta (→ title/desc/canonical), headings (→ h1-h6 list), findings (record or list quote-backed observations/inferences for this chat).\n" +
    "Research results carry {source:{url,title,observed_at,kind:page_observation},data}; source identifies where text was observed, not independent truth. For research, use text+query for a relevant passage or links+query to find its original citations; narrow by visible heading/title/domain. Read long text with offset/next_offset. Avoid selector_html and guessed CSS for reading articles.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Optional tab handle; defaults to this task's focused tab" },
      type: {
        type: "string",
        enum: ["tables", "links", "text", "forms", "selector_text", "selector_html", "meta", "headings", "findings"],
        description: "What to extract",
      },
      query: {type:"string",description:"text: find a literal phrase or section heading and nearby passages. links: filter URL, label or surrounding citation text (e.g. a claim, source name or domain)."},
      offset: {type:"number",description:"Start offset for text, or item index for matched passages, selectors, links and headings; use returned next_offset to continue"},
      max_chars: {type:"number",description:"Text window size, 500–6000 characters (default 5000)"},
      findings: {type:"array",description:"For type=findings: batch up to 12 key conclusions from the current page, with copied supporting quotes. Omit to list saved findings.",items:{type:"object",properties:{statement:{type:"string"},quote:{type:"string",description:"Supporting text copied from this rendered page"},kind:{type:"string",enum:["observation","inference"]}},required:["statement","quote"],additionalProperties:false}},
      selector: {
        type: "string",
        description: "CSS selector (required for selector_text / selector_html; optional scope for text)",
      },
      include_hidden: {
        type: "boolean",
        description: "Include hidden elements (default false)",
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
  handler: async (args, _emit, harness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    if(args.type==='findings'&&harness&&(args.findings===undefined||Array.isArray(args.findings)&&args.findings.length===0))
      return {ok:true,output:JSON.stringify({findings:findingsForTask(harness.taskId).list(),provenance_only:true})};
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const type = String(args["type"] ?? "") as ExtractType;
    if (String(args.type) === 'findings') {
      const session=getBrowserSession(sessionId); if(!session)return {ok:false,error:'Unknown browser session'};
      const ledger=findingsForTask(harness?.taskId??'session:'+sessionId);
      try {
        const items=args.findings as BrowserFindingInput[]|undefined;
        if(items&&(!Array.isArray(items)||items.length>12))return {ok:false,error:'findings must be an array of up to 12 items'};
        const source=items?.length?await session.page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText??''})):undefined;
        const findings=source?ledger.record(source,items!):ledger.list();
        return {ok:true,output:JSON.stringify({findings,provenance_only:true,note:'Matched quotes establish page provenance, not independent verification of the claim. Cite the source URLs; keep inferences labelled.'})};
      } catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)};}
    }
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
      args["include_hidden"] === true,
      typeof args["query"] === "string" ? args["query"] : undefined,
      {offset:Math.max(0,Number(args.offset)||0),maxChars:Number(args.max_chars)||5000,includeSource:!!harness}
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
      session_id: { type: "string", description: "Optional tab handle; defaults to this task's focused tab" },
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

// A child agent must not commandeer a sibling's live page, even with a known ID.
for (const tool of [browserSnapshotTool, browserNavigateTool, browserActTool, browserCloseTool,
  browserWaitForTool, browserExtractTool, browserCookiesTool, browserCredentialsTool]) {
  const handler = tool.handler;
  tool.handler = async (args, emit, harness, context) => {
    if(tool===browserExtractTool&&args.type==='findings'&&harness&&(args.findings===undefined||Array.isArray(args.findings)&&args.findings.length===0))
      return handler(args,emit,harness,context);
    const newTabAction=tool===browserActTool&&!!args.url;
    const closeAll=tool===browserCloseTool&&args.close_all===true;
    if(harness&&!args.session_id&&!newTabAction&&!closeAll){
      const tabs=browserWorkspaceState().tabs;
      const focused=browserWorkspaceState(harness.taskId).selectedTabId ?? focusedTaskTabs.get(harness);
      if(focused&&tabs.some(tab=>tab.sessionId===focused))args={...args,session_id:focused};
      else {
        const owned=tabs.filter(tab=>tab.ownerTaskId===harness.taskId);
        if(owned.length===1)args={...args,session_id:owned[0]!.sessionId};
        else if(owned.length>1)return {ok:false,error:"Multiple tabs belong to this task and none is selected. Pass the intended session_id from browser_tabs; no action was executed."};
      }
    }
    if(args.session_id&&harness){
      const requested=String(args.session_id).trim(),tabs=browserWorkspaceState().tabs;
      const matches=tabs.filter(tab=>tab.sessionId===requested||modelSessionId(tab.sessionId)===requested);
      if(matches.length!==1){
        const own=tabs.filter(tab=>tab.ownerTaskId===harness.taskId);
        const available=own.map(tab=>({session_id:modelSessionId(tab.sessionId),title:tab.title,paused:tab.paused}));
        return {ok:false,error:'Unknown browser session_id. No action executed. Current task tabs: '+JSON.stringify(available)};
      }
      args={...args,session_id:matches[0]!.sessionId};
    }
    const id = typeof args.session_id === "string" ? args.session_id : "";
    if (id && harness) {
      const error = checkBrowserSessionOwner(id, harness.taskId);
      if (error) return { ok: false, error };
    }
    if(id&&tool!==browserCloseTool){const restored=await ensureBrowserSessionActive(id);if(!restored.ok)return restored;}
    const result=await handler(args,emit,harness,context);
    if(result.ok&&harness&&id){
      if(tool===browserCloseTool)focusedTaskTabs.delete(harness);
      else { focusedTaskTabs.set(harness,id); selectBrowserTaskTab(harness.taskId,id); }
    }
    return modelSessionResult(result,harness);
  };
}

// Serialize whole operations, including selected-tab resolution and observation.
// Internal search -> navigate/open calls are reentrant; other chats stay parallel.
for(const tool of [browserOpenTool,browserSearchTool,browserTabsTool,browserSnapshotTool,
 browserNavigateTool,browserActTool,browserCloseTool,browserWaitForTool,browserExtractTool,
 browserCookiesTool,browserCredentialsTool]){
 const handler=tool.handler;
 tool.handler=(args,emit,harness,context)=>withBrowserTask(harness?.taskId??'anonymous',()=>handler(args,emit,harness,context));
}
