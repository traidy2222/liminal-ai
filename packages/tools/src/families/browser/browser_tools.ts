/**
 * Playwright browser tools — session-based agentic workflow (see browser_runtime.ts).
 */
import { defineTool } from "../../shared/helpers.js";
import {indexBrowserLoginMetadata} from './browser_credentials.js';
import type { AgentHarness, PropertySchema } from "@liminal/core";
import {
  browserEnabled,
  browserWorkspaceState,
  getBrowserSession,
  browserObservedDestination,
  browserSessionContainsRefs,
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
import { resolveWorkspaceRoot, effectiveHarnessEnvRaw } from "@liminal/core";
import { findingsForTask, type BrowserFindingInput } from "./browser_findings.js";
import {withBrowserTask,isCurrentBrowserTask} from './browser_queue.js';
import {attachBrowserImage} from './browser_native_images.js';
import {browserResearchCheckpointPath} from './browser_research_checkpoint.js';
import {requestedBrowserDates,applyBrowserDateContext,isCurrentBrowserTabHandle,browserPageMatches} from './browser_navigation_context.js';

function dateContextFor(harness?:AgentHarness){
  const messages=harness?.getContext?.().getConversationMessages();
  const message=messages&&[...messages].reverse().find(m=>m.role==='user');
  const content=message?.content;
  const text=typeof content==='string'?content:Array.isArray(content)?content.map(p=>p.type==='text'?p.text:'').join('\n'):'';
  return requestedBrowserDates(text);
}

function contextualNavigationArgs(args:Record<string,unknown>,harness?:AgentHarness){
  const dates=dateContextFor(harness),changes:string[]=[];
  const selected=harness?browserWorkspaceState(harness.taskId).selectedTabId:undefined;
  const current=getBrowserSession(String(args.session_id??selected??''))?.page.url();
  const apply=(url:string)=>{try{const result=applyBrowserDateContext(url,dates,current);changes.push(...result.changes);return result.url;}catch{return url;}};
  let adjusted=args;
  if(typeof args.url==='string')adjusted={...adjusted,url:apply(args.url)};
  if(Array.isArray(args.actions))adjusted={...adjusted,actions:args.actions.map(a=>a&&typeof a==='object'&&a.op==='goto'&&typeof a.url==='string'?{...a,url:apply(a.url)}:a)};
  return {args:adjusted,changes};
}

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

    return { ok: true, output: opened.output };
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
    "WHAT: Navigate this chat's selected tab, keeping cookies. Prefer ref from an observed link to retain its exact dates and other query fields; use url for a known destination.\n" +
    "WHEN: Change page without browser_close + browser_open. Alternative: browser_act goto op.\n" +
    "Returns fresh SNAPSHOT_REFS and READABLE_CONTENT after navigation. Follow observed destinations; use browser_search when the exact source URL is unknown instead of guessing article IDs or paths.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      url: { type: "string" },
      ref: {type:'string',description:'Observed link ref, e.g. e12. Use instead of url; survives replacement of the same link node.'},
      wait_ms: { type: "number", description: "Idle wait after navigation (0–30000)" },
      wait_until: {
        type: "string",
        enum: ["domcontentloaded", "load", "networkidle"],
      },
      navigation_timeout_ms: { type: "number" },
      include_console: { type: "boolean" },
      screenshot: { type: "boolean", description: "Save PNG under .agent_artifacts/browser/ after navigation" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args, _emit, harness) => {
    const gate = browserGate();
    if (!gate.ok) return gate;
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    if(args.url&&args.ref)return {ok:false,error:'Provide either an observed link ref or url, not both.'};
    let href=String(args.url??'');
    if(args.ref){try{href=browserObservedDestination(sessionId,String(args.ref));}catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)};}}
    const initial=resolveBrowseHref(href);if(!initial.ok)return initial;
    const contextual=applyBrowserDateContext(initial.href,dateContextFor(harness),getBrowserSession(sessionId)?.page.url());
    const resolved = resolveBrowseHref(contextual.url);
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
    return { ok: true, output: (contextual.changes.length?'NAVIGATION_CONTEXT_APPLIED: '+contextual.changes.join(', ')+'\n':'')+res.output };
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
  actionObject(['drag_at'],['from_x','from_y','to_x','to_y'],{from_x:{type:'number',minimum:0,maximum:100000},from_y:{type:'number',minimum:0,maximum:100000},to_x:{type:'number',minimum:0,maximum:100000},to_y:{type:'number',minimum:0,maximum:100000},duration_ms:{type:'integer',minimum:100,maximum:5000}}),
  actionObject(["click_at"], ["x","y"], {x:{type:"number",minimum:0,maximum:100000},y:{type:"number",minimum:0,maximum:100000}}),
  actionObject(["type_text"], ["value"], {value:{type:"string",minLength:1,maxLength:16000}}),
  actionObject(["reload"], [], {wait_until:{type:"string",enum:["load","domcontentloaded"]},timeout_ms}),
  actionObject(["wait_ms"], ["ms"], {ms: {type: "number", minimum: 0, maximum: 120000}}),
  actionObject(["wait_ms"], ["value"], {value: {type: "number", minimum: 0, maximum: 120000}}),
  actionObject(["wait_ms"], ["wait_ms"], {wait_ms: {type: "number", minimum: 0, maximum: 120000}}),
  {type:'object',properties:{wait_ms:{type:'number',minimum:0,maximum:120000}},required:['wait_ms'],additionalProperties:false},
  actionObject(["fill_ref", "type_ref", "select_option_ref"], ["ref", "value"], {ref, value, timeout_ms, delay_ms: {type: "number"}}),
  actionObject(["click_ref", "double_click_ref", "check_ref", "uncheck_ref", "focus_ref", "clear_ref", "hover_ref"], ["ref"], {ref, timeout_ms}),
  actionObject(["press_and_hold_ref"], ["ref","duration_ms"], {ref,duration_ms:{type:"integer",minimum:100,maximum:15000,description:"Hold the left mouse button continuously, then release; milliseconds. Use an observed enabled control."},timeout_ms}),
  actionObject(["press_key"], ["key"], {key: {type: "string"}}),
  actionObject(["press_key_ref"], ["ref", "key"], {ref, key: {type: "string"}, timeout_ms}),
  actionObject(["fill", "select_option"], ["selector", "value"], {selector, value, timeout_ms}),
  actionObject(["click_selector", "hover", "check", "uncheck"], ["selector"], {selector, timeout_ms}),
  actionObject(["goto"], ["url"], {url: {type: "string"}, wait_until: {type: "string", enum: ["load", "domcontentloaded", "networkidle"]}, timeout_ms}),
  actionObject(["click_role"], ["role", "name"], {role: {type: "string"}, name: {type: "string"}, exact: {type: "boolean"}, timeout_ms}),
  actionObject(["click_text", "double_click_text"], ["text"], {text: {type: "string"}, exact: {type: "boolean"}, timeout_ms}),
  actionObject(["scroll"], ["direction"], {direction: {type: "string", enum: ["top", "bottom", "up", "down", "left", "right"]}, px: {type: "number"}}),
  actionObject(["wait_selector"], ["selector"], {selector, state: {type: "string", enum: ["visible", "attached"]}, timeout_ms}),
  actionObject(["wait_navigation"], [], {wait_until: {type: "string", enum: ["load", "domcontentloaded", "networkidle"]}, timeout_ms}),
  actionObject(["screenshot"], [], {full_page: {type: "boolean"}}),
] };

export const browserActTool = defineTool({
  name: "browser_act",
  description:
    "WHAT: Run structured actions on this chat's selected browser tab. Omit session_id unless switching to another observed tab; url opens a new tab.\n" +
    "Ops: press_and_hold_ref (ref + duration_ms; continuous pointer hold then release, including embedded frames), reload (refresh the current tab and preserve its URL), double_click_ref / double_click_text (native double-click), select_option_ref (native or custom dropdown; value is its option label), goto, wait_ms, scroll, click_ref, fill_ref, focus_ref, clear_ref, type_ref, press_key_ref, press_key, click_selector (selector field), wait_navigation, screenshot, …\n" +
    "Examples: { op:'goto', url:'https://news.ycombinator.com/ask' }; { op:'type_ref', ref:'e2', value:'query' }; { op:'press_key', key:'Enter' }.\n" +
    "fill_ref replaces a field value; use type_ref when key-by-key events are needed. check_ref/uncheck_ref set checkbox state idempotently. SNAPSHOT_REFS include row context, focus, values, validation and checked state. Copy-link actions return PAGE_COPY_LINKS when the page supplies a URL; the existing system clipboard is never read.\n" +
    "For screenshot-only controls: click_at {x,y}, drag_at {from_x,from_y,to_x,to_y,duration_ms:900}, and type_text {value} at keyboard focus. All coordinates are current viewport CSS pixels. Drag uses a real held pointer and releases it on cancellation. Batch related actions; prefer observed refs when available. Use browser_credentials for secrets. For editor shortcuts, press_key_ref focuses the exact editor; editor_path and editor_depth describe nested rows.\n" +
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
  handler: async (args, _emit, harness, context) => {
    const gate = browserGate();
    if (!gate.ok) return gate;

    if(args.actions===undefined&&args.steps===undefined&&args.session_id){
      return snapshotBrowserSession(String(args.session_id),args.include_console===true);
    }
    const parsed = args.actions===undefined&&args.steps===undefined&&args.url
      ? [] : parseActionsFromArgs(args["actions"], args["steps"]);
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
        signal: context?.signal,
      });
      if (!res.ok) return res;
      return { ok: true, output: res.output };
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
    if(!actions.length)return opened;
    return actOnBrowserSession({
      sessionId: opened.sessionId,
      actions,
      postActionWaitMs: postWaitMs,
      includeConsole,
      refreshSnapshot,
      compactObservation: args.full_snapshot !== true,
      signal:context?.signal,
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
    return { ok: true, output: res.output };
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
  try{indexBrowserLoginMetadata();}catch{/* Browser metadata must not prevent harness startup. */}
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
    "WHEN: After browser_act triggers an async action (form submit, SPA navigation). Returns fresh page text and refs after success or timeout; continue from that screen. Network idle only describes network activity, not task completion.",
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
  const navigation=contextualNavigationArgs(args,harness);
  let result=await openHandler(navigation.args,emit,harness,context);
  if(result.ok&&navigation.changes.length)result={...result,output:'NAVIGATION_CONTEXT_APPLIED: '+navigation.changes.join(', ')+'\n'+result.output};
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
    const captchaSolver = effectiveHarnessEnvRaw('AGENT_CAPTCHA_KEY')?.trim() ? {
      token_tool:'captcha_solve', inspect_tool:'captcha_inspect', service:effectiveHarnessEnvRaw('AGENT_CAPTCHA_SERVICE')?.trim()||'2captcha',
      supported_types:['recaptcha_v2','recaptcha_v3','hcaptcha','turnstile','image',...(effectiveHarnessEnvRaw('AGENT_CAPTCHA_SERVICE')==='capsolver'?[]:['coordinates'])],
      ...(effectiveHarnessEnvRaw('AGENT_CAPTCHA_SERVICE')==='capsolver'?{}:{drag_tool:'captcha_drag'}),
    } : undefined;
    return { ok: true, output: JSON.stringify({ profile: "default", selectedTabId: state.selectedTabId && harness ? modelSessionId(state.selectedTabId) : state.selectedTabId, tabs: state.tabs.map(t=>({session_id:harness?modelSessionId(t.sessionId):t.sessionId,title:t.title,url:t.url,paused:t.paused,suspended:t.suspended})),captchaSolver }) };
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
  description: "Manage shared account metadata and encrypted local logins. accounts lists accounts across chats without a tab. prepare needs username and returns login.id as credential_id; fill needs credential_id and fresh password_ref (optional username_ref/confirm_password_ref). list returns this site's saved logins. After successful signup/sign-in, record_account with username, owner (assistant/user), credential_id if present, and a short evidence quote from the resulting page; this makes the account available automatically in future chats. Preparing/filling alone never marks signup complete. For passwordless sign-in, record login_method=email_code, magic_link or oauth without preparing/linking an unused password. Passwords never appear in tool arguments/results.",
  requiresApproval: false, dangerLevel: "cautious",
  parameters: { type: "object", properties: {
    action: {type: "string", enum: ["prepare", "fill", "list", "accounts", "record_account"]}, session_id: {type: "string"},
    owner:{type:'string',enum:['assistant','user','unknown']},email:{type:'string'},
    login_method:{type:'string',enum:['password','email_code','magic_link','oauth','unknown'],description:'Observed sign-in method; defaults to unknown. A signed-in session can be recorded before its future login method is established.'},
    status:{type:'string',enum:['active','blocked','closed']},evidence:{type:'string',minLength:5,maxLength:500,description:'Required for record_account: an exact short visible phrase from the current success/signed-in or blocked/closed page. No paraphrase or explanation.'},
    username: {type: "string"}, credential_id: {type: "string"}, username_ref: {type: "string"},
    password_ref: {type: "string", description: "e-number for Password from the latest SNAPSHOT_REFS, e.g. e1"}, confirm_password_ref: {type: "string", description: "e-number for Confirm password, e.g. e2"},
  }, required: ["action"], additionalProperties: false },
  handler: async args => { const gate = browserGate(); return gate.ok ? browserCredentialAction(args) : gate; },
});

// Keep one tool, but publish and validate each action's actual contract.
const credentialVariants: Array<[string,string[],string[]]> = [
 ['accounts',[],[]],['list',[],[]],
 ['prepare',['username'],['username','owner']],
 ['fill',['credential_id','password_ref'],['credential_id','username_ref','password_ref','confirm_password_ref']],
 ['record_account',['evidence'],['username','credential_id','email','owner','status','evidence','login_method']],
];
browserCredentialsTool.parameters.anyOf=credentialVariants.map(([action,required,allowed])=>({type:'object',
 properties:Object.fromEntries([['action',{type:'string',enum:[action]}],...['session_id',...allowed].map(key=>[key,{}])]),
 required:['action',...required],additionalProperties:false,
}));


export const browserExtractTool = defineTool({
  name: "browser_extract",
  description:
    "WHAT: Extract structured data from the current browser session without reading raw HTML.\n" +
    "Types: tables (→ bounded rows with headers and inherited rowspan cells; query filters complete rows), links (→ href+text), text (→ rendered text with whitespace/hyphen tolerant query), forms (→ field schema, including inputs outside forms, open shadow roots and visible embedded frames),\n" +
    "selector_text / selector_html (→ matched elements), meta (→ title/desc/canonical), headings (→ h1-h6 list), findings (record or list quote-backed observations/inferences for this chat).\n" +
    "Research results carry {source:{url,title,observed_at,kind:page_observation},data,checkpoint}; checkpoint saves progress locally. Long links return a ref for browser_act click_ref, preserving the exact destination. For research, use text+query for passages or links+query for citations. offset_unit identifies character versus item pagination; continue with next_offset. Avoid selector_html and guessed CSS for reading articles.",
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
      query: {type:"string",description:"text: phrase/heading with whitespace/hyphen tolerance; falls back to all words within one passage or cell. tables: filter complete rows including inherited cells. links: filter URL, label or citation context."},
      offset: {type:"number",minimum:0,description:"Zero-based character position ONLY for text without query. Otherwise zero-based item index. Copy returned next_offset to continue; null means finished."},
      max_chars: {type:"number",minimum:500,maximum:6000,description:"Extraction data budget, 500–6000 characters (default 5000); source metadata is additional"},
      expected_url: {type:'string',description:'Optional expected page URL. Origin, path and any supplied query values must match; extra tracking fields are allowed.'},
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
    if(args.type==='findings'&&harness&&(args.findings===undefined||Array.isArray(args.findings)&&args.findings.length===0)){
      const checkpoint=browserResearchCheckpointPath(harness.taskId);
      return {ok:true,output:JSON.stringify({findings:findingsForTask(harness.taskId).list(),...(fs.existsSync(path.join(resolveWorkspaceRoot(),checkpoint))?{checkpoint}:{}),provenance_only:true})};
    }
    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: "session_id is required" };
    const type = String(args["type"] ?? "") as ExtractType;
    if(typeof args.expected_url==='string'){
      const actual=getBrowserSession(sessionId)?.page.url();
      if(!actual||!browserPageMatches(args.expected_url,actual))return {ok:false,error:`PAGE_CHANGED: expected ${args.expected_url}, current ${actual?.split('?')[0]??'unavailable'}. The requested page or query fields do not match; no content extracted.`};
    }
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
    if(tool===browserCredentialsTool&&args.action==='accounts')return handler(args,emit,harness,context);
    if(tool===browserExtractTool&&args.type==='findings'&&harness&&(args.findings===undefined||Array.isArray(args.findings)&&args.findings.length===0))
      return handler(args,emit,harness,context);
    const newTabAction=tool===browserActTool&&!!args.url;
    const closeAll=tool===browserCloseTool&&args.close_all===true;
    if(harness&&isCurrentBrowserTabHandle(args.session_id))args={...args,session_id:undefined};
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
      let matches=tabs.filter(tab=>tab.sessionId===requested||modelSessionId(tab.sessionId)===requested);
      if(matches.length===0){
        const refs=typeof args.ref==='string'?[args.ref]:Array.isArray(args.actions)?args.actions.flatMap(a=>a&&typeof a==='object'&&typeof a.ref==='string'?[a.ref]:[]):[];
        matches=tabs.filter(tab=>tab.ownerTaskId===harness.taskId&&browserSessionContainsRefs(tab.sessionId,refs));
      }
      if(matches.length!==1){
        const own=tabs.filter(tab=>tab.ownerTaskId===harness.taskId);
        const available=own.map(tab=>({session_id:modelSessionId(tab.sessionId),title:tab.title,paused:tab.paused}));
        return {ok:false,error:'Unknown browser session_id. No action executed. Omit session_id to use this chat\'s selected tab. Current task tabs: '+JSON.stringify(available)};
      }
      args={...args,session_id:matches[0]!.sessionId};
    }
    const id = typeof args.session_id === "string" ? args.session_id : "";
    if (id && harness) {
      const error = checkBrowserSessionOwner(id, harness.taskId);
      if (error) return { ok: false, error };
    }
    if(id&&tool!==browserCloseTool){const restored=await ensureBrowserSessionActive(id);if(!restored.ok)return restored;}
    if(id&&harness&&tool!==browserCloseTool){focusedTaskTabs.set(harness,id);selectBrowserTaskTab(harness.taskId,id);}
    const navigation=tool===browserNavigateTool||tool===browserActTool?contextualNavigationArgs(args,harness):{args,changes:[]};
    let result=await handler(navigation.args,emit,harness,context);
    if(result.ok&&navigation.changes.length)result={...result,output:'NAVIGATION_CONTEXT_APPLIED: '+navigation.changes.join(', ')+'\n'+result.output};
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
 const sessionProperty=tool.parameters.properties?.session_id;
 if(sessionProperty)sessionProperty.description="Optional observed tab ID. Omit, or use 'current', for this chat's selected tab.";
 tool.handler=(args,emit,harness,context)=>{
  if(tool===browserCredentialsTool&&args.action==='accounts')return handler(args,emit,harness,context);
  const taskId=harness?.taskId??'anonymous',nested=isCurrentBrowserTask(taskId);
  return withBrowserTask(taskId,async()=>{
   if(harness){harness.registry?.activate(['captcha_inspect']);if(effectiveHarnessEnvRaw('AGENT_CAPTCHA_KEY')?.trim())harness.registry?.activate(['captcha_solve',...(effectiveHarnessEnvRaw('AGENT_CAPTCHA_SERVICE')==='capsolver'?[]:['captcha_drag'])]);}
   const result=await handler(args,emit,harness,context);
   return nested?result:attachBrowserImage(harness,tool.name,result);
 });
 };
}
