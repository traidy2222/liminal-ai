/**
 * Playwright browser session runtime — shared by browser_* tools.
 * Tab identity survives turns; idle pages sleep and wake in the shared profile.
 * The UI and agent operate the same live page.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { effectiveHarnessEnvRaw, resolveWorkspaceRoot } from "@liminal/core";
import type { Page, Browser, BrowserContext, Locator, Frame } from "playwright";
import { acquireBrowserPage, releaseBrowserPage, shutdownBrowserProfile, browserProfileRoot,
  readBrowserWorkspace, saveBrowserWorkspace, ownsBrowserProfile, lockBrowserProfile, type BrowserTabRecord } from "./browser_profile.js";
import { prepareBrowserLogin, savedBrowserLogins, readBrowserLoginForFill } from "./browser_credentials.js";
import { BrowserObservations, formatBrowserSnapshot } from "./browser_observation.js";
import { pageExtractedItems, pageExtractedText, compactExtractedLinks } from "./browser_extraction.js";
import { browserDeadline } from "./browser_deadline.js";
import { saveBrowserResearchCheckpoint } from "./browser_research_checkpoint.js";
import {withBrowserTask,browserTaskIsActive} from './browser_queue.js';
import {
  startBrowserScreencast,
  stopBrowserScreencastForSession,
  browserScreencastHasSubscribers,
} from "./browser_screencast.js";

export type WaitUntilNav = "domcontentloaded" | "load" | "networkidle";

export interface SnapshotRef {
  role: string;
  name: string;
  exact?: boolean;
  /** CSS selector from DOM fallback (preferred for click_ref when present). */
  selector?: string;
  frame?: Frame;
  href?: string;
  observedUrl?: string;
}



export type BrowserActOp =
  | { op: "wait_ms"; ms: number }
  | { op: "reload"; wait_until?: WaitUntilNav; timeout_ms?: number }
  | { op: "scroll"; direction: "bottom" | "top" | "down" | "up"; px?: number }
  | { op: "wait_selector"; selector: string; state?: "visible" | "attached"; timeout_ms?: number }
  | { op: "click_selector"; selector: string; timeout_ms?: number }
  | { op: "click_role"; role: string; name: string; exact?: boolean; timeout_ms?: number }
  | { op: "click_text"; text: string; exact?: boolean; timeout_ms?: number }
  | { op: "click_ref"; ref: string; timeout_ms?: number }
  | { op: "check_ref" | "uncheck_ref"; ref: string; timeout_ms?: number }
  | { op: "double_click_ref"; ref: string; timeout_ms?: number }
  | { op: "double_click_text"; text: string; exact?: boolean; timeout_ms?: number }
  | { op: "fill"; selector: string; value: string; timeout_ms?: number }
  | { op: "fill_ref"; ref: string; value: string; timeout_ms?: number }
  | { op: "focus_ref"; ref: string; timeout_ms?: number }
  | { op: "clear_ref"; ref: string; timeout_ms?: number }
  | { op: "type_ref"; ref: string; value: string; delay_ms?: number; timeout_ms?: number }
  | { op: "press_key_ref"; ref: string; key: string; timeout_ms?: number }
  | { op: "goto"; url: string; wait_until?: WaitUntilNav; timeout_ms?: number }
  | { op: "hover"; selector: string; timeout_ms?: number }
  | { op: "hover_ref"; ref: string; timeout_ms?: number }
  | { op: "press_key"; key: string }
  | { op: "wait_navigation"; wait_until?: WaitUntilNav; timeout_ms?: number }
  | { op: "select_option"; selector: string; value: string; timeout_ms?: number }
  | { op: "select_option_ref"; ref: string; value: string; timeout_ms?: number }
  | { op: "check"; selector: string; timeout_ms?: number }
  | { op: "uncheck"; selector: string; timeout_ms?: number }
  | { op: "screenshot"; full_page?: boolean };

type DiagnosticBuffers = {
  consoleMsgs: string[];
  pageErrors: string[];
  failedReqs: string[];
};

type PwConsoleMessage = {
  type(): string;
  text(): string;
  location(): { url?: string; lineNumber: number; columnNumber: number };
};

interface BrowserSession {
  sessionId: string;
  ownerTaskId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  currentUrl: string;
  refs: Map<string, SnapshotRef>;
  diagnostics: DiagnosticBuffers;
  createdAt: number;
  lastUsedAt: number;
  lastScreenshotPath?: string;
  backend?: "webview" | "screencast";
  title?: string;
  paused?: boolean;
  restoreUrl?: string;
  observations?: BrowserObservations;
}

const sessions = new Map<string, BrowserSession>();
function observationFor(session: BrowserSession, snapshot: string, full = false): string {
  session.observations ??= new BrowserObservations();
  return session.observations.format(session.page.url(), snapshot, full);
}
// The native host can disappear before the daemon receives its shutdown signal.
// Preserve unexpectedly detached tabs so that closing the app does not erase them.
const dormantTabs = new Map<string, BrowserTabRecord>();
const openingTabs = new Map<string, number>();
let stopping = false;
let restoring = false;
const selectedTaskTabs = new Map<string, string>();
const visibleTabs=new Set<string>();
const busyBrowserTasks=new Map<string,()=>boolean>();
const registeredBrowserHarnesses=new WeakSet<object>();
const hibernatingTabs=new Map<string,Promise<boolean>>();
const wakingTabs=new Map<string,Promise<{ok:true;sessionId:string;output:string}|{ok:false;error:string}>>();
let idleTimer:ReturnType<typeof setInterval>|undefined;
let capacityQueue=Promise.resolve();

export function browserWorkspaceState(ownerTaskId?: string) {
  const live = [...sessions.values()].filter(s => !ownerTaskId || s.ownerTaskId === ownerTaskId).map(s => ({
    sessionId: s.sessionId, ownerTaskId: s.ownerTaskId, url: s.currentUrl,
    title: s.title || "Browser", paused: s.paused === true, backend: s.backend ?? "screencast",suspended:false,lastUsedAt:s.lastUsedAt,
  }));
  const tabs=[...[...dormantTabs.values()].filter(t=>!sessions.has(t.sessionId)&&(!ownerTaskId||t.ownerTaskId===ownerTaskId)).map(t=>({...t,suspended:true,backend:'dormant'})),...live];
  const selected = ownerTaskId ? selectedTaskTabs.get(ownerTaskId) : undefined;
  return { profile: "default", profilePath: browserProfileRoot(), tabs,
    selectedTabId: ownerTaskId ? tabs.find(t => t.sessionId === selected)?.sessionId ?? tabs.at(-1)?.sessionId ?? null : null,
    selectedTabs: Object.fromEntries([...selectedTaskTabs].filter(([owner]) => !ownerTaskId || owner === ownerTaskId)),
    history: readBrowserWorkspace().history,liveTabCount:sessions.size,suspendedTabCount:dormantTabs.size };
}

export function selectBrowserTaskTab(ownerTaskId: string, sessionId: string): void {
  if ((sessions.get(sessionId)??dormantTabs.get(sessionId))?.ownerTaskId !== ownerTaskId) return;
  selectedTaskTabs.set(ownerTaskId, sessionId);
  persistBrowserTabs();
}

function persistBrowserTabs(visit?: { url: string; title: string }): void {
  if (stopping || restoring || !ownsBrowserProfile()) return;
  const tabs: BrowserTabRecord[] = browserWorkspaceState().tabs;
  saveBrowserWorkspace(tabs, visit, Object.fromEntries(selectedTaskTabs));
}

export function checkBrowserSessionOwner(sessionId: string, taskId: string): string | undefined {
  const session = sessions.get(sessionId)??dormantTabs.get(sessionId);
  if (session?.paused) return "User takeover is active. Wait for the user to resume agent control of this tab.";
  if (session && session.ownerTaskId !== taskId) {
    return "This tab belongs to another agent. Use browser_tabs to find your tabs or open a separate tab.";
  }
  return undefined;
}

export async function browserCredentialAction(args: Record<string, unknown>) {
  const session = sessions.get(String(args.session_id ?? ""));
  if (!session) return { ok: false as const, error: "Browser session not found" };
  if (session.paused) return { ok: false as const, error: "User takeover is active" };
  try {
    if (args.action === "prepare") return { ok: true as const, output: JSON.stringify({ login: prepareBrowserLogin(session.page.url(), String(args.username ?? "")), status: "credential_saved_account_not_yet_verified" }) };
    if (args.action === "list") return { ok: true as const, output: JSON.stringify({ logins: savedBrowserLogins(session.page.url()) }) };
    if (args.action !== "fill") return { ok: false as const, error: "action must be prepare, fill or list" };
    const fields: Record<string, Locator> = {};
    for(const key of ["username_ref","password_ref","confirm_password_ref"]){
      const ref=args[key];if(ref==null&&key!=="password_ref")continue;
      if(typeof ref!=="string"||!/^e\d+$/.test(ref))return {ok:false as const,error:`${key} must be an e-number from the current SNAPSHOT_REFS, not a selector or DOM marker.`};
      const meta=session.refs.get(ref);if(!meta)return {ok:false as const,error:`Unknown ref ${ref}; call browser_snapshot for current refs.`};
      if(meta.frame&&new URL(meta.frame.url()).origin!==new URL(session.page.url()).origin)return {ok:false as const,error:"The credential field is in a different origin. Open the actual sign-in site before filling."};
      const field=resolveRefLocator(session.page,ref,session.refs);
      const valid=await field.evaluate(el=>el instanceof HTMLInputElement&&el.type==='password',undefined,{timeout:5000}).catch(()=>false);
      if(key!=='username_ref'&&!valid)return {ok:false as const,error:`${key} ${ref} is not a current password input. Refresh the snapshot.`};
      fields[key]=field;
    }
    const login=readBrowserLoginForFill(session.page.url(),String(args.credential_id??''));
    if(fields.username_ref)await fields.username_ref.fill(login.username,{timeout:5000});
    await fields.password_ref!.fill(login.password,{timeout:5000});
    if(fields.confirm_password_ref)await fields.confirm_password_ref.fill(login.password,{timeout:5000});
    return { ok: true as const, output: "SAVED_LOGIN_FILLED: password remains in the encrypted local store. Submit and verify the account page separately." };
  } catch {
    // Locator failures may include the input value; keep generated passwords out of traces.
    return { ok: false as const, error: "Saved login operation failed. Check the origin, credential id and fresh input refs; the stored password was not exposed." };
  }
}

function attachSessionLifecycle(session: BrowserSession): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  session.page.on("framenavigated", frame => {
    if (frame !== session.page.mainFrame()) return;
    if (!session.page.url().startsWith("chrome-error:") && session.page.url() !== "about:blank") session.restoreUrl = undefined;
    session.currentUrl = session.restoreUrl ?? session.page.url(); session.refs.clear();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void publishBrowserView(session, true).catch(() => undefined); }, 150);
    timer.unref();
  });
  session.page.on("close", () => {
    if (timer) clearTimeout(timer);
    if (!sessions.delete(session.sessionId)) return;
    if (session.backend === "webview" && !stopping) dormantTabs.set(session.sessionId, {
      sessionId: session.sessionId, ownerTaskId: session.ownerTaskId, url: session.currentUrl,
      title: session.title || "Browser", paused: session.paused === true,
    });
    publishBrowserViewClosed(session.sessionId);
    persistBrowserTabs();
  });
}

export type BrowserViewPayload = {
  sessionId: string;
  url: string;
  title?: string;
  imagePath?: string;
  open: boolean;
  updatedAt: number;
  viewportWidth?: number;
  viewportHeight?: number;
  /** CDP screencast WebSocket is available for this session. */
  liveStream?: boolean;
  /** `webview` = native embed (desktop); `screencast` = JPEG stream (web fallback). */
  embedMode?: "webview" | "screencast";
  paused?: boolean;
};

/** Minimal session handle for stream handlers (sidecar / web). */
export type BrowserSessionHandle = {
  sessionId: string;
  currentUrl: string;
  page: Page;
};

export function getBrowserSession(sessionId: string): BrowserSessionHandle | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  return { sessionId: s.sessionId, currentUrl: s.currentUrl, page: s.page };
}

/** Navigate only an observed link from this still-current document. Exact query
 * strings (dates, occupancy and currency) remain in the cached destination. */
export function browserObservedDestination(sessionId:string,ref:string):string {
  const session=sessions.get(sessionId),link=session?.refs.get(ref);
  if(!session||!link?.href||link.role!=='link')throw new Error(`Unknown link ref ${ref}. Read the current page's link refs.`);
  if(link.frame?.isDetached()||link.observedUrl!==(link.frame??session.page).url())throw new Error(`Stale link ref ${ref}. The source document changed; refresh its links.`);
  return link.href;
}

export function browserSessionContainsRefs(sessionId:string,refs:string[]):boolean {
  const session=sessions.get(sessionId);
  return !!session&&refs.length>0&&refs.every(ref=>session.refs.has(ref));
}

export function syncBrowserSessionUrl(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) s.currentUrl = s.page.url();
}

export function applyScreencastFrame(sessionId: string, buf: Buffer): void {
  if (buf.length > 64) panelFrames.set(sessionId, buf);
}

export async function refreshBrowserEmbedView(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  await publishBrowserView(session, true);
}

const browserViewPublishers = new Map<string, (payload: BrowserViewPayload) => void>();

/** Sidecar/desktop UI subscribes via harness emitter to drive an embedded browser panel. */
export function setBrowserViewPublisher(
  fn: ((payload: BrowserViewPayload) => void) | null,
  taskId?: string
): void {
  const key = taskId?.trim() || "__default__";
  if (fn) browserViewPublishers.set(key, fn);
  else browserViewPublishers.delete(key);
}

export function setBrowserViewPublisherForTask(
  taskId: string,
  fn: ((payload: BrowserViewPayload) => void) | null
): void {
  setBrowserViewPublisher(fn, taskId);
}

function browserEmbedEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_BROWSER_EMBED") !== "0";
}

function workspaceRelativePath(absPath: string): string {
  const root = path.resolve(resolveWorkspaceRoot());
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return absPath.replace(/\\/g, "/");
  return rel.split(path.sep).join("/");
}

/** In-memory latest viewport JPEG per session — served via sidecar `/browser_preview`. */
const panelFrames = new Map<string, Buffer>();
const panelFramePaths = new Map<string, string>();

export function getBrowserPanelFrame(sessionId: string): Buffer | undefined {
  const buf = panelFrames.get(sessionId);
  if (buf && buf.length > 0) return buf;
  const diskPath = panelFramePaths.get(sessionId);
  if (diskPath) {
    try {
      const fromDisk = fs.readFileSync(diskPath);
      if (fromDisk.length > 64) {
        panelFrames.set(sessionId, fromDisk);
        return fromDisk;
      }
    } catch {
      // fall through
    }
  }
  return undefined;
}

async function capturePanelFrame(page: Page): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    assertPageWithinFileRoots(page);
    try {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, 180 * attempt));
      }
      const buf = await page.screenshot({
        type: "jpeg",
        quality: 68,
        fullPage: false,
        timeout: 20_000,
      });
      if (buf.length > 64) return buf;
    } catch {
      // retry
    }
  }
  return null;
}

async function publishBrowserView(session: BrowserSession, open: boolean): Promise<void> {
  if (open) assertPageWithinFileRoots(session.page);
  if (!browserEmbedEnabled()) return;
  let imagePath: string | undefined;
  let title: string | undefined;
  if (open) {
    title = (await browserDeadline(() => session.page.title(), 1200, 'Page title').catch(() => session.title ?? "")) || undefined;
    session.title = title;
    session.currentUrl = session.restoreUrl ?? session.page.url();
    persistBrowserTabs({ url: session.currentUrl, title: title || "Browser" });
    const buf = session.backend === "webview" ? null : panelFrames.get(session.sessionId) ?? await capturePanelFrame(session.page);
    if (!sessions.has(session.sessionId)) return;
    if (buf) {
      panelFrames.set(session.sessionId, buf);
      try {
        const shotPath = panelFramePaths.get(session.sessionId) ?? browserArtifactPath(`panel-${session.sessionId}`, "jpg");
        fs.writeFileSync(shotPath, buf);
        panelFramePaths.set(session.sessionId, shotPath);
        imagePath = workspaceRelativePath(shotPath);
      } catch {
        // disk write optional — HTTP preview uses in-memory buffer
      }
    }
  }
  const vp = session.page.viewportSize();
  const viewportWidth = vp?.width ?? 1280;
  const viewportHeight = vp?.height ?? 800;
  const publisher =
    browserViewPublishers.get(session.ownerTaskId) ??
    browserViewPublishers.get("__default__");
  if (!publisher) return;
  publisher({
    sessionId: session.sessionId,
    url: session.currentUrl,
    title,
    imagePath,
    open,
    updatedAt: Date.now(),
    viewportWidth,
    viewportHeight,
    liveStream: open,
    embedMode: session.backend ?? "screencast",
    paused: session.paused === true,
  });
}

function publishBrowserViewClosed(sessionId: string): void {
  void stopBrowserScreencastForSession(sessionId);
  panelFrames.delete(sessionId);
  const framePath = panelFramePaths.get(sessionId);
  if (framePath) { try { fs.unlinkSync(framePath); } catch { /* best-effort preview cleanup */ } }
  panelFramePaths.delete(sessionId);
  if (!browserEmbedEnabled()) return;
  for (const publisher of browserViewPublishers.values()) {
    publisher({
      sessionId,
      url: "",
      open: false,
      updatedAt: Date.now(),
    });
  }
}

type StaticServerRecord = { server: Server; ownerTaskId: string; rootDir: string };
const staticServers: StaticServerRecord[] = [];

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "switch",
  "searchbox",
  "slider",
  "spinbutton",
]);

export function browserEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_BROWSER") === "1";
}

/** Hard wall clock per browser tool invocation (launch + nav + actions). */
export async function withBrowserWall<T>(fn: () => Promise<T>): Promise<T> {
  const wallMs = parseHarnessMs("AGENT_BROWSER_WALL_MS", 120_000, 600_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Browser wall timeout (${wallMs}ms) — navigation or actions took too long. Check URL, wait_until, or raise AGENT_BROWSER_WALL_MS.`
            )
          );
        }, wallMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function parseHarnessMs(key: string, fallback: number, max = 600_000): number {
  const raw = effectiveHarnessEnvRaw(key)?.trim();
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return Math.min(Math.max(fallback, 5000), max);
  return Math.min(Math.max(n, 5000), max);
}

/** Own launches across setup failures and wall timeouts, including late launches. */
async function withOwnedBrowser<T>(
  fn: (browser: Browser, signal: AbortSignal) => Promise<{ result: T; keepOpen?: boolean }>
): Promise<T> {
  const controller = new AbortController();
  let browser: Browser | undefined;
  let keepOpen = false;
  try {
    return await withBrowserWall(async () => {
      const launched = await launchBrowser();
      if (controller.signal.aborted) {
        await launched.close().catch(() => undefined);
        controller.signal.throwIfAborted();
      }
      browser = launched;
      const value = await fn(launched, controller.signal);
      controller.signal.throwIfAborted();
      keepOpen = value.keepOpen === true;
      return value.result;
    });
  } finally {
    controller.abort();
    if (!keepOpen) await browser?.close().catch(() => undefined);
  }
}

export function playwrightInstallHint(original: string): string {
  if (/browserType\.launch|executable doesn|ENOENT|executablePath/i.test(original)) {
    return (
      `${original}\n(Hint: run \`cd packages/tools && npx playwright install chromium\` once, then retry.)`
    );
  }
  return original;
}

function pathEscapesSandbox(rootNormalized: string, candidateNormalized: string): boolean {
  const rel = path.relative(rootNormalized, candidateNormalized);
  return rel.startsWith("..") || path.isAbsolute(rel);
}

export function realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function extraFileRootsFromEnv(): string[] {
  const raw = effectiveHarnessEnvRaw("AGENT_BROWSER_FILE_ROOT")?.trim();
  if (!raw) return [];
  return raw
    .split(process.platform === "win32" ? /;/ : /[;:]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => realpathSafe(p));
}

export function assertFileMayBeOpened(fsPathAbs: string): { ok: true } | { ok: false; error: string } {
  if (!fs.existsSync(fsPathAbs))
    return { ok: false, error: `file URL points to missing path: ${fsPathAbs}` };
  if (effectiveHarnessEnvRaw("AGENT_BROWSER_ALLOW_FILE_ANY") === "1") return { ok: true };
  const cand = realpathSafe(fsPathAbs);
  const wsCanon = realpathSafe(resolveWorkspaceRoot());
  if (!pathEscapesSandbox(wsCanon, cand)) return { ok: true };
  for (const ex of extraFileRootsFromEnv()) {
    if (!pathEscapesSandbox(ex, cand)) return { ok: true };
  }
  return {
    ok: false,
    error:
      `Refusing file:// outside workspace (${wsCanon}). Set AGENT_BROWSER_FILE_ROOT or AGENT_BROWSER_ALLOW_FILE_ANY=1.\n` +
      `Resolved file: ${cand}`,
  };
}

function assertPageWithinFileRoots(page: Page): void {
  const href = page.url();
  if (!href.startsWith("file:")) return;
  const gate = resolveBrowseHref(href);
  if (!gate.ok) throw new Error(gate.error);
}

export function resolveBrowseHref(
  rawInput: string
): { ok: true; href: string } | { ok: false; error: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, error: "url is empty" };
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "javascript:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "vbscript:"
    ) {
      return { ok: false, error: `Unsupported URL scheme: ${parsed.protocol}` };
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return { ok: true, href: parsed.href };
    if (parsed.protocol === "file:") {
      let fsPath = fileURLToPath(parsed.href);
      fsPath = realpathSafe(fsPath);
      const gate = assertFileMayBeOpened(fsPath);
      if (!gate.ok) return gate;
      return { ok: true, href: pathToFileURL(fsPath).href };
    }
    return {
      ok: false,
      error: `Unsupported URL scheme ${parsed.protocol} (allowed: http:, https:, file:)`,
    };
  } catch {
    return {
      ok: false,
      error: "Invalid URL. Use absolute http(s):// or file:///…",
    };
  }
}

function formatConsoleLine(msg: PwConsoleMessage, maxLen = 420): string {
  const kind = msg.type().toUpperCase();
  const text = msg.text().trim();
  let loc = "";
  try {
    const l = msg.location();
    if (l?.url && typeof l.lineNumber === "number") {
      loc = ` @ ${l.url}:${l.lineNumber}:${l.columnNumber ?? 0}`;
    }
  } catch {
    /* optional */
  }
  const base = `${kind}: ${text}${loc}`;
  return base.length > maxLen ? base.slice(0, maxLen) + "…" : base;
}

function formatPageError(err: unknown, maxLen = 2000): string {
  if (err instanceof Error) {
    const s = (err.stack && err.stack.trim().length > 0 ? err.stack : err.message).trim();
    return s.length > maxLen ? s.slice(0, maxLen) + "\n…(truncated)" : s;
  }
  return String(err).slice(0, maxLen);
}

function attachDiagnostics(page: Page, b: DiagnosticBuffers): void {
  page.on("console", (m) => {
    b.consoleMsgs.push(formatConsoleLine(m as PwConsoleMessage));
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

export function formatDiagnosticsOutput(b: DiagnosticBuffers): string {
  const con = [...new Set(b.consoleMsgs)].slice(-8).join("\n").slice(0,1500) || "(none)";
  const pe = b.pageErrors.length
    ? [...new Set(b.pageErrors)].slice(-3).join("\n\n--- page error ---\n\n").slice(0,1500)
    : "(none)";
  const fr = [...new Set(b.failedReqs)].slice(-5).join("\n").slice(0,1000) || "(none)";
  return (
    `\nCONSOLE:\n${con}\nPAGE_ERRORS:\n${pe}\nFAILED_REQUESTS:\n${fr}`
  );
}

/** True when buffered console/page/network signals indicate a broken page. */
export function browserDiagnosticsHasErrors(b: DiagnosticBuffers): boolean {
  if (b.pageErrors.length > 0) return true;
  const consoleErr = b.consoleMsgs.some(
    (line) =>
      /\[(error|warning)\]/i.test(line) ||
      (/\b(error|exception|uncaught|failed)\b/i.test(line) && !/\bno errors?\b/i.test(line))
  );
  if (consoleErr) return true;
  return b.failedReqs.some((r) => /\b(404|500|net::ERR_|failed to load)\b/i.test(r));
}

/** Summarize error-level browser diagnostics for open sessions owned by a task. */
export function collectBrowserDiagnosticsForTask(taskId: string): string | null {
  const parts: string[] = [];
  for (const s of sessions.values()) {
    if (s.ownerTaskId !== taskId) continue;
    if (!browserDiagnosticsHasErrors(s.diagnostics)) continue;
    parts.push(
      `SESSION ${s.sessionId} (${s.currentUrl}):\n${formatDiagnosticsOutput(s.diagnostics)}`
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function maxSessionsPerTask(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_BROWSER_MAX_SESSIONS") ?? "2", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 8;
}

function sessionTtlMs(): number {
  return parseHarnessMs("AGENT_BROWSER_SESSION_TTL_MS", 120_000, 600_000);
}

function browserTaskBusy(taskId:string){return browserTaskIsActive(taskId)||busyBrowserTasks.get(taskId)?.()===true;}
function startBrowserIdleCleanup(){if(!idleTimer){idleTimer=setInterval(()=>{void hibernateIdleBrowserTabs().catch(()=>{});},30000);idleTimer.unref();}}
async function safeToHibernate(session:BrowserSession):Promise<boolean>{
 if(session.paused||visibleTabs.has(session.sessionId)||browserScreencastHasSubscribers(session.sessionId)||browserTaskBusy(session.ownerTaskId))return false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([session.page.evaluate(()=>{
  if(window.onbeforeunload||[...document.querySelectorAll('audio,video')].some(el=>!(el as HTMLMediaElement).paused&&!(el as HTMLMediaElement).ended))return false;
  if((window as unknown as Record<string,unknown>).__liminalUnsavedEdits)return false;
  return ![...document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')].some(el=>{
   if(el instanceof HTMLInputElement){if(['hidden','search','submit','button'].includes(el.type)||/^(q|query|search)$/i.test(el.name))return false;if(['checkbox','radio'].includes(el.type))return el.checked!==el.defaultChecked;return el.value!==el.defaultValue;}
   if(el instanceof HTMLTextAreaElement)return el.value!==el.defaultValue;
   return [...el.options].some(o=>o.selected!==o.defaultSelected);
  });
 }).catch(()=>false),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),1500);timer.unref();})]);}
 finally{if(timer)clearTimeout(timer);}
}
async function hibernateBrowserTab(id:string):Promise<boolean>{
 if(hibernatingTabs.has(id))return false;
 const work=(async()=>{
  const session=sessions.get(id),lastUsedAt=session?.lastUsedAt;
  if(!session||!await safeToHibernate(session)||sessions.get(id)!==session||lastUsedAt!==session.lastUsedAt||browserTaskBusy(session.ownerTaskId)||visibleTabs.has(id)||browserScreencastHasSubscribers(id))return false;
  dormantTabs.set(id,{sessionId:id,ownerTaskId:session.ownerTaskId,url:session.currentUrl,title:session.title||'Browser',paused:session.paused===true,lastUsedAt:session.lastUsedAt});
  sessions.delete(id);publishBrowserViewClosed(id);persistBrowserTabs();
  if(session.backend)await releaseBrowserPage(id,session.page,session.backend).catch(()=>{});else await session.browser.close().catch(()=>{});
  return true;
 })();hibernatingTabs.set(id,work);
 try{return await work;}finally{hibernatingTabs.delete(id);}
}
export async function hibernateIdleBrowserTabs(now=Date.now()):Promise<number>{
 let count=0;for(const session of [...sessions.values()])if(now-session.lastUsedAt>sessionTtlMs()&&await hibernateBrowserTab(session.sessionId))count++;return count;
}
async function reserveBrowserSlot(owner:string):Promise<string|undefined>{
 const reserve=capacityQueue.then(async()=>{
  const limit=Math.max(1,Math.min(12,parseInt(effectiveHarnessEnvRaw('AGENT_BROWSER_MAX_LIVE_TABS')??'4',10)||4)),opening=()=>[...openingTabs.values()].reduce((a,b)=>a+b,0);
  for(const session of [...sessions.values()].sort((a,b)=>a.lastUsedAt-b.lastUsedAt)){
   if(sessions.size+opening()<limit)break;await hibernateBrowserTab(session.sessionId);
  }
  if(sessions.size+opening()>=limit)return 'All live browser slots are active or contain unsaved work. Close a tab or finish the other browser task, then retry.';
  openingTabs.set(owner,(openingTabs.get(owner)??0)+1);return undefined;
 });capacityQueue=reserve.then(()=>{},()=>{});return reserve;
}
export async function ensureBrowserSessionActive(id:string){
 await hibernatingTabs.get(id);
 if(sessions.has(id)){touchSession(sessions.get(id)!);return {ok:true as const};}
 const saved=dormantTabs.get(id);if(!saved)return {ok:false as const,error:'Browser tab is no longer available.'};
 let pending=wakingTabs.get(id);if(!pending){pending=openBrowserSession({ownerTaskId:saved.ownerTaskId,href:saved.url,sessionId:id,restore:true,waitUntil:'domcontentloaded',navTimeoutMs:20000,postWaitMs:0,includeConsole:false,includeSnapshot:false});wakingTabs.set(id,pending);}
 try{const result=await pending;if(result.ok){const session=sessions.get(id)!;session.paused=saved.paused;dormantTabs.delete(id);}else dormantTabs.set(id,saved);persistBrowserTabs();return result;}finally{if(wakingTabs.get(id)===pending)wakingTabs.delete(id);}
}

function countSessionsForTask(taskId: string): number {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.ownerTaskId === taskId) n++;
  }
  for(const tab of dormantTabs.values())if(tab.ownerTaskId===taskId&&!sessions.has(tab.sessionId))n++;
  return n;
}

async function launchBrowser(): Promise<Browser> {
  const pw = await import("playwright");
  const headed = effectiveHarnessEnvRaw("AGENT_BROWSER_HEADED") === "1";
  return pw.chromium.launch({
    headless: !headed,
    timeout: 60_000,
    args: [
      "--disable-dev-shm-usage",
      // Disable the AutomationControlled blink feature — prevents navigator.webdriver=true at C++ level
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--use-mock-keychain",
    ],
  });
}

const DEFAULT_STEALTH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function resolveStealthUserAgent(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_BROWSER_USER_AGENT")?.trim() ||
    effectiveHarnessEnvRaw("AGENT_WEB_FETCH_USER_AGENT")?.trim() ||
    DEFAULT_STEALTH_UA
  );
}

function parseChromeMajorFromUa(ua: string): number {
  const m = /\bChrome\/(\d+)/.exec(ua);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 90) return n;
  }
  return 136;
}

/**
 * Builds the stealth init script with site-specific values embedded as literals.
 * Covers eight fingerprint signals: webdriver, chrome object, languages, Permissions API,
 * plugins/mimeTypes (Plugin.prototype + item/namedItem), userAgentData (hides HeadlessChrome
 * brand), WebGL renderer, and Worker constructor intercept (patches worker scope).
 */
function buildStealthInitScript(opts: {
  chromeMajor: number;
  chromeFullVersion: string;
  webglVendor: string;
  webglRenderer: string;
}): string {
  const mv = JSON.stringify(String(opts.chromeMajor));
  const full = JSON.stringify(opts.chromeFullVersion);
  const vendor = JSON.stringify(opts.webglVendor);
  const renderer = JSON.stringify(opts.webglRenderer);

  // Self-contained worker-scope stealth: values baked in as literals so the blob is standalone.
  // Must use only var/function (no const/let/class) for widest Worker compat.
  // This string is JSON-stringified and embedded in the outer init script as a string literal.
  const workerPayload = `(function(){try{Object.defineProperty(self.navigator,'webdriver',{get:function(){return undefined;},configurable:true});}catch(_){}try{var m=${mv},f=${full};var u={brands:[{brand:'Not.A/Brand',version:'24'},{brand:'Chromium',version:m},{brand:'Google Chrome',version:m}],mobile:false,platform:'Windows',getHighEntropyValues:function(h){var o={};if(h.indexOf('brands')>=0)o.brands=this.brands;if(h.indexOf('mobile')>=0)o.mobile=this.mobile;if(h.indexOf('platform')>=0)o.platform=this.platform;if(h.indexOf('architecture')>=0)o.architecture='x86';if(h.indexOf('bitness')>=0)o.bitness='64';if(h.indexOf('model')>=0)o.model='';if(h.indexOf('platformVersion')>=0)o.platformVersion='10.0.0';if(h.indexOf('fullVersionList')>=0)o.fullVersionList=[{brand:'Not.A/Brand',version:'24.0.0.0'},{brand:'Chromium',version:f},{brand:'Google Chrome',version:f}];if(h.indexOf('uaFullVersion')>=0)o.uaFullVersion=f;return Promise.resolve(o);},toJSON:function(){return{brands:this.brands,mobile:this.mobile,platform:this.platform};}};Object.defineProperty(self.navigator,'userAgentData',{get:function(){return u;},configurable:true});}catch(_){}try{var v=${vendor},r=${renderer};var pw=function(C){if(!C)return;var g=C.prototype.getParameter;C.prototype.getParameter=function(x){if(x===37445)return v;if(x===37446)return r;return g.call(this,x);};};if(typeof WebGLRenderingContext!=='undefined')pw(WebGLRenderingContext);if(typeof WebGL2RenderingContext!=='undefined')pw(WebGL2RenderingContext);}catch(_){}})();`;
  const workerJs = JSON.stringify(workerPayload);

  return `(function () {
  // 1. navigator.webdriver — the single most-checked property
  try {
    var proto = Object.getPrototypeOf(navigator);
    var desc = Object.getOwnPropertyDescriptor(proto, 'webdriver')
      || Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    if (!desc || desc.configurable !== false) {
      Object.defineProperty(proto, 'webdriver', { get: function() { return undefined; }, configurable: true });
    }
  } catch (_) {}

  // 2. window.chrome — absent in headless
  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        writable: true, enumerable: true, configurable: false,
        value: { runtime: {}, loadTimes: function(){return{};}, csi: function(){return{};}, app: {} }
      });
    }
  } catch (_) {}

  // 3. navigator.languages
  try {
    Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US', 'en']; }, configurable: true });
  } catch (_) {}

  // 4. Permissions API — headless returns 'denied'; real Chrome returns 'default'
  try {
    var _origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(params) {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: 'default', onchange: null });
      }
      return _origQuery(params);
    };
  } catch (_) {}

  // 5. navigator.plugins / mimeTypes
  //    Object.create(Plugin.prototype) → instanceof Plugin passes.
  //    item()/namedItem() on PluginArray.prototype → native null-returning methods replaced.
  try {
    var _fakePdf = Object.create(Plugin.prototype);
    Object.defineProperty(_fakePdf, 'name', { value: 'PDF Viewer', enumerable: true });
    Object.defineProperty(_fakePdf, 'description', { value: 'Portable Document Format', enumerable: true });
    Object.defineProperty(_fakePdf, 'filename', { value: 'internal-pdf-viewer', enumerable: true });
    Object.defineProperty(_fakePdf, 'length', { get: function() { return 1; }, enumerable: true });
    var _fakePdfChrome = Object.create(Plugin.prototype);
    Object.defineProperty(_fakePdfChrome, 'name', { value: 'Chrome PDF Viewer', enumerable: true });
    Object.defineProperty(_fakePdfChrome, 'description', { value: 'Portable Document Format', enumerable: true });
    Object.defineProperty(_fakePdfChrome, 'filename', { value: 'internal-pdf-viewer', enumerable: true });
    Object.defineProperty(_fakePdfChrome, 'length', { get: function() { return 1; }, enumerable: true });
    Object.defineProperty(PluginArray.prototype, 'length', { get: function() { return 2; }, configurable: true });
    Object.defineProperty(PluginArray.prototype, '0', { get: function() { return _fakePdf; }, configurable: true });
    Object.defineProperty(PluginArray.prototype, '1', { get: function() { return _fakePdfChrome; }, configurable: true });
    Object.defineProperty(PluginArray.prototype, 'item', {
      value: function(n) { if (n === 0) return _fakePdf; if (n === 1) return _fakePdfChrome; return null; },
      configurable: true, writable: true
    });
    Object.defineProperty(PluginArray.prototype, 'namedItem', {
      value: function(n) {
        if (n === 'PDF Viewer') return _fakePdf;
        if (n === 'Chrome PDF Viewer') return _fakePdfChrome;
        return null;
      },
      configurable: true, writable: true
    });
  } catch (_) {}
  try {
    var _fakeMime = Object.create(MimeType.prototype);
    Object.defineProperty(_fakeMime, 'type', { value: 'application/pdf', enumerable: true });
    Object.defineProperty(_fakeMime, 'suffixes', { value: 'pdf', enumerable: true });
    Object.defineProperty(_fakeMime, 'description', { value: 'Portable Document Format', enumerable: true });
    Object.defineProperty(MimeTypeArray.prototype, 'length', { get: function() { return 1; }, configurable: true });
    Object.defineProperty(MimeTypeArray.prototype, '0', { get: function() { return _fakeMime; }, configurable: true });
    Object.defineProperty(MimeTypeArray.prototype, 'item', {
      value: function(n) { return n === 0 ? _fakeMime : null; },
      configurable: true, writable: true
    });
    Object.defineProperty(MimeTypeArray.prototype, 'namedItem', {
      value: function(n) { return n === 'application/pdf' ? _fakeMime : null; },
      configurable: true, writable: true
    });
  } catch (_) {}

  // 6. navigator.userAgentData — Playwright reports internal Chromium version with HeadlessChrome brand
  try {
    var _majorStr = ${mv};
    var _fullVer = ${full};
    var _fakeUAD = {
      brands: [
        { brand: 'Not.A/Brand', version: '24' },
        { brand: 'Chromium', version: _majorStr },
        { brand: 'Google Chrome', version: _majorStr }
      ],
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: function(hints) {
        var r = {};
        if (hints.indexOf('brands') >= 0) r.brands = this.brands;
        if (hints.indexOf('mobile') >= 0) r.mobile = this.mobile;
        if (hints.indexOf('platform') >= 0) r.platform = this.platform;
        if (hints.indexOf('architecture') >= 0) r.architecture = 'x86';
        if (hints.indexOf('bitness') >= 0) r.bitness = '64';
        if (hints.indexOf('model') >= 0) r.model = '';
        if (hints.indexOf('platformVersion') >= 0) r.platformVersion = '10.0.0';
        if (hints.indexOf('fullVersionList') >= 0) r.fullVersionList = [
          { brand: 'Not.A/Brand', version: '24.0.0.0' },
          { brand: 'Chromium', version: _fullVer },
          { brand: 'Google Chrome', version: _fullVer }
        ];
        if (hints.indexOf('uaFullVersion') >= 0) r.uaFullVersion = _fullVer;
        return Promise.resolve(r);
      },
      toJSON: function() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; }
    };
    Object.defineProperty(navigator, 'userAgentData', { get: function() { return _fakeUAD; }, configurable: true });
  } catch (_) {}

  // 7. WebGL renderer — SwiftShader (software renderer) is a strong headless signal
  try {
    var _webglVendor = ${vendor};
    var _webglRenderer = ${renderer};
    var _patchWebGL = function(Ctx) {
      if (!Ctx) return;
      var _orig = Ctx.prototype.getParameter;
      Ctx.prototype.getParameter = function(p) {
        if (p === 37445) return _webglVendor;   // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return _webglRenderer; // UNMASKED_RENDERER_WEBGL
        return _orig.call(this, p);
      };
    };
    _patchWebGL(WebGLRenderingContext);
    if (typeof WebGL2RenderingContext !== 'undefined') _patchWebGL(WebGL2RenderingContext);
  } catch (_) {}

  // 8. Worker constructor intercept — addInitScript only runs in page/frame scope, not Workers.
  //    For classic (non-module) Workers: prepend stealth blob + importScripts(originalAbsUrl).
  //    Blob URL inherits page origin so same-origin importScripts works without CORS.
  //    Falls back to original Worker for module workers or cross-origin URLs.
  try {
    var _wjs = ${workerJs};
    var _OW = window.Worker;
    window.Worker = function StealthWorker(url, opts) {
      if (!opts || opts.type !== 'module') {
        try {
          var abs = new URL(String(url), document.baseURI || location.href).href;
          var blob = new Blob([_wjs + '\\nimportScripts(' + JSON.stringify(abs) + ');'], { type: 'application/javascript' });
          return new _OW(URL.createObjectURL(blob), opts);
        } catch (_e) {}
      }
      return new _OW(url, opts);
    };
    window.Worker.prototype = _OW.prototype;
    try { Object.defineProperty(window.Worker, 'toString', { value: _OW.toString.bind(_OW) }); } catch (_) {}
  } catch (_) {}
})();`;
}

async function buildStealthContext(
  browser: Browser,
  viewport?: { width: number; height: number },
  userAgentOverride?: string
): Promise<BrowserContext> {
  const ua = userAgentOverride?.trim() || resolveStealthUserAgent();
  const locale = effectiveHarnessEnvRaw("AGENT_BROWSER_LOCALE")?.trim() || "en-US";
  // Default to system timezone — JS/IP timezone mismatch is a high-signal bot indicator
  const timezoneId =
    effectiveHarnessEnvRaw("AGENT_BROWSER_TIMEZONE")?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  const context = await browser.newContext({
    viewport: viewport ?? { width: 1280, height: 800 },
    userAgent: ua,
    locale,
    timezoneId,
    colorScheme: "light",
    deviceScaleFactor: 1,
  });

  if (effectiveHarnessEnvRaw("AGENT_BROWSER_STEALTH") !== "0") {
    const chromeMajor = parseChromeMajorFromUa(ua);
    const chromeFullVersion =
      effectiveHarnessEnvRaw("AGENT_BROWSER_CHROME_FULL_VERSION")?.trim() ||
      `${chromeMajor}.0.0.0`;
    const webglVendor =
      effectiveHarnessEnvRaw("AGENT_BROWSER_WEBGL_VENDOR")?.trim() ||
      "Google Inc. (Intel)";
    const webglRenderer =
      effectiveHarnessEnvRaw("AGENT_BROWSER_WEBGL_RENDERER")?.trim() ||
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)";
    await context.addInitScript(
      buildStealthInitScript({ chromeMajor, chromeFullVersion, webglVendor, webglRenderer })
    );
  }
  return context;
}

type DomSnapshotItem = { role: string; name: string; selector: string; state: string; href?: string };
let snapshotRefCounter = 0;
const domRefNamespace = "__liminal_refs_" + randomUUID().replaceAll("-", "");
const frameNodeRefs = new WeakMap<Frame, Map<string,string>>();

async function buildDomSnapshotRefs(target: Page | Frame, maxItems = 48): Promise<{items:DomSnapshotItem[];readable:string;context:string;contextSelector:string}> {
  return target.evaluate(({limit,token,namespace})=>{
    const state=window as unknown as Record<string,WeakMap<Element,string>>;
    if(!state[namespace])Object.defineProperty(state,namespace,{value:new WeakMap<Element,string>()});
    const identities=state[namespace]!;
    const visible=(el:Element):boolean=>{
      if(!el.getClientRects().length) return false;
      let current:Element|null=el;
      while(current){
        if(current.matches('[hidden],[inert],[aria-hidden="true"]'))return false;
        const style=getComputedStyle(current);
        // Styled native checkboxes/radios are often transparent overlays. They
        // remain real hit targets and expose state through accessibility.
        if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'&&!(current===el&&el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)))return false;
        current=current.parentElement??(current.getRootNode() instanceof ShadowRoot ? (current.getRootNode() as ShadowRoot).host:null);
      }
      return true;
    };
    function renderedText(root:Element):string {
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),pieces:string[]=[],seen=new WeakMap<Element,boolean>();
      let previous:Element|null=null,lastStrike:Element|null=null;
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        const parent=node.parentElement,text=node.textContent?.replace(/\s+/g,' ').trim();
        if(!parent||!text||parent.closest('select,option,script,style,noscript'))continue;
        let shown=seen.get(parent);
        if(shown===undefined){
          shown=parent.getClientRects().length>0||getComputedStyle(parent).display==='contents';
          for(let el:Element|null=parent;shown&&el;el=el.parentElement){const s=getComputedStyle(el);if(el.matches('[hidden],[inert]')||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')shown=false;}
          seen.set(parent,shown);
        }
        if(!shown)continue;
        const block=parent.closest('p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,article,section,main,body');
        let strike=parent.closest('del,s,strike');
        if(!strike)for(let el:Element|null=parent;el;el=el.parentElement){if(getComputedStyle(el).textDecorationLine.includes('line-through')){strike=el;break;}}
        pieces.push((pieces.length?(block===previous?' ':'\n'):'')+(strike&&strike!==lastStrike?'[struck through] ':'')+text);
        previous=block;lastStrike=strike;
      }
      return pieces.join('');
    }
    const modal=[...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')].filter(visible).at(-1);
    const root=modal??document.body;
    root.setAttribute("data-liminal-context",token);
    const selector='a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="option"],[role="listbox"],[role="checkbox"],[role="radio"],[role="tab"],[role="switch"],[contenteditable="true"],label,[ondblclick]';
    const nodes:Element[]=[];
    const collect=(scope:Element|ShadowRoot)=>{
      nodes.push(...scope.querySelectorAll(selector));
      for(const el of scope.querySelectorAll('*'))if(el.shadowRoot)collect(el.shadowRoot);
    };
    collect(root);
    // Listings often put a large filter form before the actual result cards.
    // Prefer semantic result rows and their title links without site-specific CSS.
    const resultCandidates=[...root.querySelectorAll('article,[role="listitem"],li')].filter(el=>
      visible(el)&&!el.closest('nav,header,footer,aside,[role="navigation"]')&&
      !!el.querySelector('h2 a[href],h3 a[href],a[href] h2,a[href] h3,[role="heading"] a[href]')&&
      (el as HTMLElement).innerText.trim().length>=80
    );
    const resultCards=resultCandidates.filter(el=>!resultCandidates.some(child=>child!==el&&el.contains(child)));
    const contentRoot=(modal??[...root.querySelectorAll('main,[role="main"]')].find(visible)??root) as HTMLElement;
    const resultChars=resultCards.reduce((sum,card)=>sum+(card as HTMLElement).innerText.trim().length,0);
    // A few related products/hotels at the foot of a detail page are not its
    // primary content. Cards must dominate before replacing the document view.
    const listing=resultCards.length>=2&&resultChars>=contentRoot.innerText.trim().length*.35;
    const resultLinks=new Set(listing?resultCards.flatMap(card=>[...card.querySelectorAll('h2 a[href],h3 a[href],a[href]:has(h2),a[href]:has(h3),[role="heading"] a[href]')]):[]);
    // Form/main controls must not disappear behind dozens of navigation links.
    const priority=(el:Element)=>listing?(resultLinks.has(el)?0:el.closest('nav,header,footer,aside,[role="navigation"]')?3:el.matches('input[type="checkbox"],input[type="radio"]')?2:1):el.closest('form,main,[role="main"],[role="dialog"],dialog')||el.matches('input,textarea,select,[contenteditable="true"]')?0:el.closest('nav,header,footer,[role="navigation"]')?2:1;
    nodes.sort((a,b)=>priority(a)-priority(b));
    const items:DomSnapshotItem[]=[];
    for(const el of nodes){
      if(!visible(el))continue;
      if(el instanceof HTMLLabelElement && (el.control || el.querySelector('input,textarea,select,[contenteditable="true"]')))continue;
      const tag=el.tagName.toLowerCase();
      const input=el instanceof HTMLInputElement?el:null;
      if(input?.type==='hidden')continue;
      const control=el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement?el:null;
      const labelled=el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>(el.getRootNode() as Document|ShadowRoot).getElementById(id)?.textContent?.trim()||'').join(' ').trim();
      const labels=control?[...(control.labels??[])].map(label=>{const copy=label.cloneNode(true) as HTMLElement;copy.querySelectorAll('input,select,textarea,[contenteditable]').forEach(child=>child.remove());return copy.textContent?.trim()||'';}).join(' '):'';
      const name=(el.getAttribute('aria-label')?.trim()||labelled||labels||el.getAttribute('placeholder')||el.getAttribute('title')||((el as HTMLElement).isContentEditable||el instanceof HTMLSelectElement?'':(el as HTMLElement).innerText?.trim())||el.getAttribute('name')||el.id||'Unlabelled control').replace(/\s+/g,' ').slice(0,160);
      const role=el.getAttribute('role')|| (tag==='select'?'combobox':tag==='textarea'||(el as HTMLElement).isContentEditable?'textbox':input?['checkbox','radio'].includes(input.type)?input.type:input.type==='search'?'searchbox':['submit','button','reset'].includes(input.type)?'button':'textbox':tag==='a'?'link':tag==='label'?'text':'button');
      const state:string[]=[];
      if(el.matches(':focus'))state.push('focused=true');
      const row=el.closest('li,tr,[role="row"],[role="listitem"]');
      if(row&&row!==el){const context=renderedText(row).replace(/\s+/g,' ').trim().slice(0,220);if(context)state.push('row='+JSON.stringify(context));}
      if(el.matches(':disabled')||el.getAttribute('aria-disabled')==='true')state.push('disabled');
      if(control?.required||el.getAttribute('aria-required')==='true')state.push('required');
      if((el as HTMLElement).isContentEditable||input&&role==='combobox'&&!input.readOnly)state.push('editable');
      if((input?.readOnly)||(el instanceof HTMLTextAreaElement&&el.readOnly))state.push('readonly');
      if(input?.type==='password')state.push(input.value?'password=filled':'password=empty');
      else if(control&&!(el instanceof HTMLSelectElement)&&control.value)state.push('value='+JSON.stringify(control.value.slice(0,180)));
      else if((el as HTMLElement).isContentEditable&&(el as HTMLElement).innerText)state.push('value='+JSON.stringify((el as HTMLElement).innerText.slice(0,180)));
      if(input&&['checkbox','radio'].includes(input.type))state.push('checked='+input.checked);
      for(const key of ['expanded','selected','checked','invalid']){const value=el.getAttribute('aria-'+key);if(value!==null)state.push(key+'='+value);}
      if(el instanceof HTMLSelectElement){state.push('selected='+JSON.stringify([...el.selectedOptions].map(o=>o.label).join(', ')));state.push('options='+JSON.stringify([...el.options].slice(0,16).map(o=>o.label)));}
      else if(el.getAttribute('aria-valuetext'))state.push('value='+JSON.stringify(el.getAttribute('aria-valuetext')));
      if(control&&!control.validity.valid&&control.validationMessage)state.push('validation='+JSON.stringify(control.validationMessage.slice(0,180)));
      const described=el.getAttribute('aria-describedby')?.split(/\s+/).map(id=>(el.getRootNode() as Document|ShadowRoot).getElementById(id)?.textContent?.trim()||'').filter(Boolean).join(' ');
      if(described)state.push('description='+JSON.stringify(described.slice(0,240)));
      const marker=identities.get(el)??token+'-'+(items.length+1);identities.set(el,marker);el.setAttribute('data-liminal-ref',marker);
      items.push({role,name,selector:'[data-liminal-ref="'+marker+'"]',state:state.join(' '),...(el instanceof HTMLAnchorElement&&/^https?:/.test(el.href)?{href:el.href}:{})});
      if(items.length>=limit)break;
    }
    const feedback=[...root.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].filter(visible).map(el=>(el as HTMLElement).innerText?.trim()).filter(Boolean).join(' | ').slice(0,1000);
    const content=(modal??[...document.querySelectorAll('main,[role="main"]')].find(visible)??root) as HTMLElement;
    const articles=[...content.querySelectorAll('article')].filter(visible);
    const readingRoot=(articles.length===1?articles[0]:content) as HTMLElement;
    const readable=listing?'RESULT_ITEMS:\n'+resultCards.slice(0,6).map((card,i)=>{
      const text=renderedText(card).replace(/\s+/g,' ').trim();
      return `[${i+1}] ${text.length>900?text.slice(0,550)+' … '+text.slice(-340):text}`;
    }).join('\n\n'):renderedText(readingRoot).replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    const canvas=[...root.querySelectorAll('canvas')].filter(visible).length;
    const unlabeledImages=[...root.querySelectorAll('img')].filter(el=>visible(el)&&!el.alt).length;
    const timestamps=[...root.querySelectorAll('time[datetime],relative-time[datetime],local-time[datetime]')].filter(visible).slice(0,24).map(el=>({text:(el as HTMLElement).innerText?.trim(),datetime:el.getAttribute('datetime'),context:el.parentElement?.innerText?.replace(/\s+/g,' ').slice(0,180)}));
    const searchPage=/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(location.hostname)&&(new URL(location.href).searchParams.has('q')||location.pathname.includes('/search'));
    const reading={page_kind:searchPage?'search_results':listing||articles.length>1?'listing':articles.length===1?'article':'page',...(listing?{result_count:resultCards.length,excerpted_results:Math.min(resultCards.length,6)}:{}),rendered_chars:readable.length,excerpt_chars:Math.min(readable.length,5000),truncated:readable.length>5000||listing&&(resultCards.length>6||resultCards.some(card=>(card as HTMLElement).innerText.replace(/\s+/g,' ').trim().length>900))};
    return {items,readable:readable.slice(0,5000)+(readable.length>5000?'\n…(readable excerpt truncated; use browser_extract for the needed section)':''),contextSelector:'[data-liminal-context="'+token+'"]',context:JSON.stringify({focus:modal?'dialog':'page',reading,text:content.innerText?.replace(/\s+/g,' ').trim().slice(0,300),...(feedback?{feedback}:{}),...(timestamps.length?{timestamps}:{}),...(canvas||unlabeledImages?{visual_content:{canvas,unlabeledImages,note:'Use a screenshot for visual content that has no DOM text.'}}:{})})};
  },{limit:maxItems,token:randomUUID(),namespace:domRefNamespace});
}

export async function buildPageSnapshot(page:Page,maxChars=8_000,timeoutMs=5000):Promise<{snapshotText:string;refs:Map<string,SnapshotRef>}> {
  assertPageWithinFileRoots(page);
  return browserDeadline(() => collectPageSnapshot(page,maxChars), timeoutMs, 'Page observation').catch(error => ({
    snapshotText: `URL: ${page.url()}\nOBSERVATION_WARNING: ${error.message} No fresh text or controls were observed.`,
    refs: new Map<string,SnapshotRef>(),
  }));
}

async function collectPageSnapshot(page:Page,maxChars:number):Promise<{snapshotText:string;refs:Map<string,SnapshotRef>}> {
  assertPageWithinFileRoots(page);
  const refs=new Map<string,SnapshotRef>(), lines:string[]=[],contexts:string[]=[],readable:string[]=[],trees:string[]=[],passwords:string[]=[];
  const nextRef=()=> 'e'+(++snapshotRefCounter);
  let destinationBudget=1400;
  const mainModal=await page.locator('dialog[open],[aria-modal="true"]').evaluateAll(elements=>elements.some(el=>el.getClientRects().length>0));
  const frames=page.frames().slice(0,12);
  for(const frame of frames){
    if(frame!==page.mainFrame()){
      const host=await frame.frameElement().catch(()=>null);
      if(!host||!await host.isVisible().catch(()=>false))continue;
      if(mainModal&&!await host.evaluate(el=>el instanceof Element && !!el.closest('dialog[open],[aria-modal="true"]')).catch(()=>false))continue;
    }
    try{
      const dom=await buildDomSnapshotRefs(frame,48);
      const frameLabel=frame===page.mainFrame()?'main':`frame ${new URL(frame.url()).origin}`;
      contexts.push(`${frameLabel}: ${dom.context}`);
      if(dom.readable)readable.push(`${frameLabel}:\n${dom.readable}`);
      for(const item of dom.items){
        let known=frameNodeRefs.get(frame);
        if(!known){known=new Map();frameNodeRefs.set(frame,known);}
        const id=known.get(item.selector)??nextRef();known.set(item.selector,id);
        if(known.size>10000){known.clear();known.set(item.selector,id);}
        refs.set(id,{role:item.role,name:item.name,exact:true,selector:item.selector,frame,href:item.href,observedUrl:frame.url()});
        const destination=item.href&&item.href.length<=Math.min(300,destinationBudget)?' href='+JSON.stringify(item.href):'';
        destinationBudget-=destination.length;
        lines.push(`  ${id} ${item.role} ${JSON.stringify(item.name)}${item.state?' '+item.state:''}${destination}${frame===page.mainFrame()?'':' [embedded frame]'}`);
      }
      const activeRoot=frame.locator(dom.contextSelector);
      const main=activeRoot.locator('main,[role="main"]').first();
      const root=await main.count()?main:activeRoot;
      const yaml=dom.readable?'':await root.ariaSnapshot().catch(()=>'');
      if(yaml)trees.push(`${frameLabel}:\n${yaml.slice(0,4500)}`);
      passwords.push(...await frame.locator('input[type="password"]').evaluateAll(elements=>elements.map(el=>(el as HTMLInputElement).value).filter(Boolean)));
    }catch(err){contexts.push(`frame observation unavailable: ${err instanceof Error?err.name:'error'}`);}
  }
  const observedAt=await page.evaluate(()=>({iso:new Date().toISOString(),local:new Date().toString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  let text=formatBrowserSnapshot({observedAt,contexts,controls:lines,readable:readable.join('\n'),tree:trees.join('\n')},maxChars);
  for(const password of passwords)text=text.replaceAll(password,'[REDACTED_PASSWORD]');
  return {snapshotText:text,refs};
}

function touchSession(s: BrowserSession): void {
  s.lastUsedAt = Date.now();
}

export async function navigateWithRenderedContent(page:Page, href:string, options:{waitUntil:WaitUntilNav;timeout:number}):Promise<string|undefined>{
  try {await browserDeadline(() => page.goto(href,options), options.timeout + 1000, 'Page navigation');return undefined;}
  catch(error){
    if(!(error instanceof Error)||!/timeout|timed out/i.test(error.message))throw error;
    const current=page.url();
    const expected=new URL(href),observed=new URL(current);
    const sameSource=expected.origin===observed.origin&&expected.pathname===observed.pathname;
    const readable=sameSource&&await browserDeadline(() => page.evaluate(()=>{
      const main=document.querySelector('article,main,[role="main"]') as HTMLElement|null;
      return document.readyState!=='loading'&&!!document.title.trim()&&!!main&&main.innerText.trim().length>400;
    }), 1200, 'Rendered document check').catch(()=>false);
    if(!readable)throw error;
    return `Requested ${options.waitUntil} did not finish within ${options.timeout}ms. Showing the rendered source document; some resources may still be loading.`;
  }
}

export async function openBrowserSession(options: {
  ownerTaskId: string;
  href: string;
  waitUntil: WaitUntilNav;
  navTimeoutMs: number;
  postWaitMs: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  includeConsole: boolean;
  includeSnapshot: boolean;
  screenshot?: boolean;
  sessionId?: string;
  restore?: boolean;
}): Promise<{ ok: true; sessionId: string; output: string } | { ok: false; error: string }> {
  startBrowserIdleCleanup();
  const openingCount = [...openingTabs.values()].reduce((sum, count) => sum + count, 0);
  if (!options.restore&&sessions.size+dormantTabs.size + openingCount >= 24) return { ok: false, error: "Browser tab limit (24) reached. Close an unused tab first." };
  const openingForTask = openingTabs.get(options.ownerTaskId) ?? 0;
  if (!options.restore&&options.ownerTaskId !== "user" && countSessionsForTask(options.ownerTaskId) + openingForTask >= maxSessionsPerTask()) {
    const openIds = [...sessions.entries()]
      .filter(([, s]) => s.ownerTaskId === options.ownerTaskId)
      .map(([id]) => id);
    return {
      ok: false,
      error:
        `Browser session limit (${maxSessionsPerTask()}) reached. Call browser_close on a session_id, or browser_close with close_all:true.\n` +
        `Open sessions: ${openIds.join(", ") || "(none)"}`,
    };
  }

  let createdSessionId: string | undefined;
  let lease: Awaited<ReturnType<typeof acquireBrowserPage>> | undefined;
  let cancelled = false;
  let kept = false;
  const sessionId = options.sessionId ?? randomUUID();
  const capacityError=await reserveBrowserSlot(options.ownerTaskId);if(capacityError)return {ok:false,error:capacityError};
  try {
    return await withBrowserWall(async () => {
    lease = await acquireBrowserPage(sessionId, { headed: effectiveHarnessEnvRaw("AGENT_BROWSER_HEADED") === "1",
      viewport: options.viewport, userAgent: options.userAgent });
    const { browser, context, page, backend } = lease;
    if (cancelled) { await releaseBrowserPage(sessionId, page, backend); throw new Error("Browser open cancelled"); }
    page.setDefaultTimeout(Math.min(30_000, options.navTimeoutMs));
    page.setDefaultNavigationTimeout(options.navTimeoutMs);
    await page.addInitScript(()=>{document.addEventListener('input',event=>{if((event.target as HTMLElement)?.isContentEditable)(window as unknown as Record<string,unknown>).__liminalUnsavedEdits=true;},true);});

    const diagnostics: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
    attachDiagnostics(page, diagnostics);

    let restoreUrl: string | undefined;
    const navigationWarning=await navigateWithRenderedContent(page,options.href, {
      waitUntil: options.waitUntil,
      timeout: options.navTimeoutMs,
    }).catch(error => {
      if (!options.restore || page.isClosed()) throw error;
      restoreUrl = options.href; // Keep an offline tab/address instead of silently losing it.
    });
    if (options.postWaitMs > 0) {
      await new Promise<void>((r) => setTimeout(r, options.postWaitMs));
    }
    if (cancelled) throw new Error("Browser open cancelled");

    assertPageWithinFileRoots(page);
    createdSessionId = sessionId;
    const session: BrowserSession = {
      sessionId,
      ownerTaskId: options.ownerTaskId,
      browser,
      context,
      page,
      currentUrl: restoreUrl ?? page.url(),
      restoreUrl,
      refs: new Map(),
      diagnostics,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      backend,
    };
    sessions.set(sessionId, session);
    dormantTabs.delete(sessionId);
    if (!options.restore) selectedTaskTabs.set(options.ownerTaskId, sessionId);
    attachSessionLifecycle(session);

    const title = await browserDeadline(() => page.title(), 1200, 'Page title').catch(() => '');
    const body = options.includeSnapshot ? '' : (await browserDeadline(() => page.innerText("body", {timeout:1200}), 1500, 'Body excerpt').catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 4000);

    let snapshotBlock = "";
    if (options.includeSnapshot) {
      const { snapshotText, refs } = await buildPageSnapshot(page);
      session.refs = refs;
      snapshotBlock = `\n${observationFor(session,snapshotText)}\n`;
    }

    if (options.screenshot) {
      const shotPath = browserArtifactPath("open");
      await page.screenshot({ path: shotPath, fullPage: true, type: "png", timeout: 45_000 });
      session.lastScreenshotPath = shotPath;
    }

    const diag =
      options.includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
    const shotLine = session.lastScreenshotPath
      ? `\nSCREENSHOT_PATH: ${session.lastScreenshotPath}`
      : "";

    const captcha = await detectCaptchaSignals(page);
    const captchaHint = captcha ? formatCaptchaHint(captcha) : "";

    const output =
      `SESSION_ID: ${sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}${navigationWarning?'\nNAVIGATION_WARNING: '+navigationWarning:''}${options.includeSnapshot?"":"\nBODY_EXCERPT:\n"+body}` +
      snapshotBlock +
      captchaHint +
      shotLine +
      diag;

    if (cancelled) throw new Error("Browser open cancelled");
    await publishBrowserView(session, true);
    kept = true;
    return { ok: true as const, sessionId, output };
    });
  } catch (err) {
    if (createdSessionId) {
      sessions.delete(createdSessionId);
      publishBrowserViewClosed(createdSessionId);
    }
    return {
      ok: false,
      error: playwrightInstallHint(err instanceof Error ? err.message : String(err)),
    };
  } finally {
    cancelled = true;
    const remaining = (openingTabs.get(options.ownerTaskId) ?? 1) - 1;
    if (remaining > 0) openingTabs.set(options.ownerTaskId, remaining); else openingTabs.delete(options.ownerTaskId);
    if (!kept && lease) await releaseBrowserPage(sessionId, lease.page, lease.backend).catch(() => undefined);
  }
}

export async function snapshotBrowserSession(
  sessionId: string,
  includeConsole: boolean
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown browser session_id: ${sessionId}` };
  touchSession(session);
  try {
    return await withBrowserWall(async () => {
    const { snapshotText, refs } = await buildPageSnapshot(session.page);
    session.refs = refs;
    session.currentUrl = session.page.url();
    const title = await browserDeadline(() => session.page.title(), 1200, 'Page title').catch(() => session.title ?? '');
    const captcha = await detectCaptchaSignals(session.page);
    const captchaHint = captcha ? formatCaptchaHint(captcha) : "";
    const diag = includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
    await publishBrowserView(session, true);
    return {
      ok: true,
      output: `SESSION_ID: ${sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}\n${observationFor(session,snapshotText,true)}${captchaHint}${diag}`,
    };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Navigate existing session to a new URL (keeps cookies/storage). */
export async function navigateBrowserSession(options: {
  sessionId: string;
  href: string;
  waitUntil: WaitUntilNav;
  navTimeoutMs: number;
  postWaitMs: number;
  includeConsole: boolean;
  screenshot?: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(options.sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  if (session.paused) return { ok: false, error: "User takeover is active. Wait for the user to resume agent control of this tab." };
  const resolved = resolveBrowseHref(options.href);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  touchSession(session);
  try {
    return await withBrowserWall(async () => {
      const navigationWarning=await navigateWithRenderedContent(session.page,resolved.href, {
        waitUntil: options.waitUntil,
        timeout: options.navTimeoutMs,
      });
      const postWait = defaultPostWaitForUrl(session.page.url(), options.postWaitMs);
      if (postWait > 0) {
        await new Promise<void>((r) => setTimeout(r, postWait));
      }
      if (options.screenshot) {
        assertPageWithinFileRoots(session.page);
        const shotPath = browserArtifactPath("nav");
        await session.page.screenshot({ path: shotPath, fullPage: true, type: "png", timeout: 45_000 });
        session.lastScreenshotPath = shotPath;
      }
      const { snapshotText, refs } = await buildPageSnapshot(session.page);
      session.refs = refs;
      session.currentUrl = session.page.url();
      const title = await browserDeadline(() => session.page.title(), 1200, 'Page title').catch(() => session.title ?? '');
      const diag = options.includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
      const shotLine = session.lastScreenshotPath ? `\nSCREENSHOT_PATH: ${session.lastScreenshotPath}` : "";
      await publishBrowserView(session, true);
      return {
        ok: true,
        output:
          `SESSION_ID: ${options.sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}${navigationWarning?'\nNAVIGATION_WARNING: '+navigationWarning:''}\n${observationFor(session,snapshotText)}${shotLine}${diag}`,
      };
    });
  } catch (err) {
    return { ok: false, error: playwrightInstallHint(err instanceof Error ? err.message : String(err)) };
  }
}

/** User navigation acts on the same page as agent tools, without mirroring. */
export async function userNavigateBrowserSession(options: {
  sessionId: string;
  href: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = sessions.get(options.sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  const resolved = resolveBrowseHref(options.href);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  touchSession(session);
  const current = session.page.url();
  if (resolved.href === current) return { ok: true, url: current };
  try {
    return await withBrowserWall(async () => {
      const navTimeoutMs = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);
      await session.page.goto(resolved.href, {
        waitUntil: "domcontentloaded",
        timeout: navTimeoutMs,
      });
      session.currentUrl = session.page.url();
      const { refs } = await buildPageSnapshot(session.page);
      session.refs = refs;
      await publishBrowserView(session, true);
      return { ok: true, url: session.currentUrl };
    });
  } catch (err) {
    return { ok: false, error: playwrightInstallHint(err instanceof Error ? err.message : String(err)) };
  }
}

function resolveRefLocator(page: Page, ref: string, refs: Map<string, SnapshotRef>) {
  const meta = refs.get(ref);
  if (!meta) throw new Error(`Unknown ref "${ref}" — call browser_snapshot or browser_open with snapshot first.`);
  if (meta.selector) {
    if (meta.frame?.isDetached()) throw new Error(`Stale frame ref "${ref}" — call browser_snapshot.`);
    return (meta.frame ?? page).locator(meta.selector).first();
  }
  return (meta.frame ?? page).getByRole(meta.role as Parameters<Page["getByRole"]>[0], {
    name: meta.name,
    exact: meta.exact ?? true,
  });
}

/** React may replace a link node while retaining the exact observed destination.
 * Recover only that labelled link on the same document; input/button refs expire. */
async function resolveClickRef(page:Page,ref:string,refs:Map<string,SnapshotRef>):Promise<Locator>{
  const locator=resolveRefLocator(page,ref,refs),meta=refs.get(ref)!;
  const frame=meta.frame??page;
  if(await locator.count()||meta.role!=='link'||!meta.href||meta.observedUrl!==frame.url())return locator;
  const token=randomUUID();
  const found=await browserDeadline(()=>frame.evaluate(({href,name,token})=>{
    const link=[...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>
      a.href===href&&!a.hasAttribute('download')&&a.getClientRects().length>0&&
      (a.getAttribute('aria-label')||a.innerText||a.getAttribute('title')||'').trim().replace(/\s+/g,' ')===name);
    if(!link)return false;
    link.setAttribute('data-liminal-click-target',token);return true;
  },{href:meta.href,name:meta.name,token}),1200,'Link refresh').catch(()=>false);
  return found?frame.locator(`[data-liminal-click-target="${token}"]`):locator;
}

async function selectBrowserOption(page:Page|Frame,locator:Locator,value:string,timeoutMs=15000):Promise<void>{
  const options=await locator.evaluate(el=>el instanceof HTMLSelectElement?[...el.options].map(o=>({value:o.value,label:o.label})):null,undefined,{timeout:timeoutMs});
  if(options){const option=options.find(o=>o.value===value)??options.find(o=>o.label===value);if(!option)throw new Error('Option not found. Available labels: '+options.map(o=>o.label).join(', '));await locator.selectOption(option.value,{timeout:timeoutMs});return;}
  const editable=await locator.evaluate(el=>el instanceof HTMLInputElement&&!el.readOnly||(el as HTMLElement).isContentEditable,undefined,{timeout:timeoutMs});
  if(editable)await locator.fill(value,{timeout:timeoutMs});else await locator.click({timeout:timeoutMs});
  const controls=(await locator.getAttribute('aria-controls')??await locator.getAttribute('aria-owns'))?.trim().split(/\s+/)[0];
  const scope=controls?page.locator(`[id=${JSON.stringify(controls)}]`):page;
  const byValue=scope.locator(`[role="option"][data-value=${JSON.stringify(value)}]:visible`).first();
  const option=await byValue.isVisible()?byValue:scope.getByRole('option',{name:value,exact:true}).first();
  await option.click({timeout:timeoutMs});
}

async function resolveBrowserSelector(page:Page,selector:string):Promise<{target:Page|Frame;locator:Locator}>{
  const main=page.locator(selector);if(await main.count())return {target:page,locator:main};
  const candidates:{target:Frame;locator:Locator}[]=[];
  for(const frame of page.frames()){
    if(frame===page.mainFrame())continue;const host=await frame.frameElement().catch(()=>null);
    if(!host||!await host.isVisible().catch(()=>false))continue;
    const locator=frame.locator(selector);if(await locator.count())candidates.push({target:frame,locator});
  }
  if(candidates.length>1)throw new Error('Selector matches multiple embedded frames. Use the intended control snapshot ref.');
  return candidates[0]??{target:page,locator:main};
}

export function clampTimeout(n: number, cap: number): number {
  if (!Number.isFinite(n) || n < 500) return Math.min(cap, 15_000);
  return Math.min(Math.max(Math.round(n), 500), cap);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeSelector(sel: unknown): string | { error: string } {
  if (typeof sel !== "string" || !sel.trim()) return { error: "selector must be non-empty string" };
  const s = sel.trim();
  if (s.length > 520) return { error: "selector too long (max 520)" };
  return s;
}

export function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Accept `selector` or common alias `sel` inside action objects. */
export function selectorField(o: Record<string, unknown>): string | { error: string } {
  const raw = o["selector"] ?? o["sel"];
  return sanitizeSelector(raw);
}

function typeDelayMs(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_BROWSER_TYPE_DELAY_MS") ?? "30", 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(200, Math.max(0, n));
}

/** Default post-action wait when caller passes 0 — HN rate-limit pacing. */
export function defaultPostWaitForUrl(pageUrl: string, explicitMs: number): number {
  if (explicitMs > 0) return explicitMs;
  try {
    const host = new URL(pageUrl).hostname;
    if (host.includes("ycombinator.com")) return 600;
  } catch {
    /* ignore */
  }
  return 400;
}

const MAX_ACTIONS_PER_CALL = 40;

export function parseActionsFromArgs(
  raw: unknown,
  stepsLegacy: unknown
): BrowserActOp[] | { ok: false; error: string } {
  if (Array.isArray(raw)) {
    if (raw.length === 0)
      return { ok: false, error: "`actions` array is empty — pass at least one op or legacy `steps`." };
    if (raw.length > MAX_ACTIONS_PER_CALL)
      return { ok: false, error: `At most ${MAX_ACTIONS_PER_CALL} actions per call.` };
    const out: BrowserActOp[] = [];
    for (const item of raw) {
      const p = normalizeOneAction(item);
      if ("error" in p) return { ok: false, error: p.error };
      out.push(p.op);
    }
    return out;
  }
  if (raw !== undefined && raw !== null)
    return { ok: false, error: "`actions` must be an array or omit." };

  const s = typeof stepsLegacy === "string" ? stepsLegacy.trim().toLowerCase() : "";
  if (!s) return { ok: false, error: "Pass `actions` or legacy `steps`." };
  if (/(bottom|scroll|down)/.test(s)) return [{ op: "scroll", direction: "bottom" }];
  if (/(top)/.test(s)) return [{ op: "scroll", direction: "top" }];
  return [{ op: "wait_ms", ms: 400 }];
}

export function normalizeOneAction(
  item: unknown
): { op: BrowserActOp } | { error: string } {
  if (!item || typeof item !== "object" || Array.isArray(item))
    return { error: "Each action must be a JSON object with `op`." };
  const o = item as Record<string, unknown>;
  const op = o["op"];
  if (typeof op !== "string" || !op.trim()) return { error: 'Each action needs string field "op".' };

  switch (op) {
    case "wait_ms": {
      const ms = Number(o["ms"]);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) return { error: "wait_ms: ms 0..120000" };
      return { op: { op: "wait_ms", ms } };
    }
    case "scroll": {
      const dir = String(o["direction"] ?? "").toLowerCase();
      if (!["bottom", "top", "down", "up"].includes(dir))
        return { error: "scroll: direction ∈ bottom|top|down|up" };
      const px = o["px"] === undefined ? undefined : Number(o["px"]);
      if (px !== undefined && (!Number.isFinite(px) || px < 1 || px > 32_000))
        return { error: "scroll: px 1..32000" };
      const d = dir as "bottom" | "top" | "down" | "up";
      return {
        op: px !== undefined ? { op: "scroll", direction: d, px } : { op: "scroll", direction: d },
      };
    }
    case "reload": return {op:{op:"reload",wait_until:o["wait_until"]==="load"?"load":"domcontentloaded",timeout_ms:clampTimeout(Number(o["timeout_ms"]??15000),60000)}};
    case "goto": {
      const url = String(o["url"] ?? "").trim();
      if (!url) return { error: "goto: url required" };
      const wu = o["wait_until"];
      const wait_until =
        wu === "load" || wu === "networkidle" || wu === "domcontentloaded"
          ? wu
          : "domcontentloaded";
      return {
        op: {
          op: "goto",
          url,
          wait_until,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 45_000), 120_000),
        },
      };
    }
    case "wait_selector": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `wait_selector: ${selector.error}` };
      const state = o["state"] === "attached" || o["state"] === "visible" ? o["state"] : undefined;
      const tm = clampTimeout(Number(o["timeout_ms"] ?? 15_000), 60_000);
      return {
        op: state
          ? { op: "wait_selector", selector, state, timeout_ms: tm }
          : { op: "wait_selector", selector, timeout_ms: tm },
      };
    }
    case "click_selector": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `click_selector: ${selector.error}` };
      return {
        op: {
          op: "click_selector",
          selector,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "click_role": {
      const role = shorten(String(o["role"] ?? "").trim(), 40);
      const name = shorten(String(o["name"] ?? "").trim(), 200);
      if (!role || !name) return { error: "click_role: role and name required" };
      return {
        op: {
          op: "click_role",
          role,
          name,
          exact: Boolean(o["exact"]),
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "double_click_text":
    case "click_text": {
      const text = shorten(String(o["text"] ?? "").trim(), 400);
      if (!text) return { error: "click_text: text required" };
      return {
        op: {
          op: op as "click_text" | "double_click_text",
          text,
          exact: Boolean(o["exact"]),
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "check_ref":
    case "uncheck_ref":
    case "double_click_ref":
    case "click_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "click_ref: ref like e1 from SNAPSHOT_REFS" };
      return {
        op: {
          op: op as "click_ref" | "double_click_ref" | "check_ref" | "uncheck_ref",
          ref,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "fill": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `fill: ${selector.error}` };
      const value = String(o["value"] ?? "");
      if (value.length > 16_000) return { error: "fill: value too long" };
      return {
        op: {
          op: "fill",
          selector,
          value,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "fill_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "fill_ref: ref like e1" };
      const value = String(o["value"] ?? "");
      return {
        op: {
          op: "fill_ref",
          ref,
          value,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "focus_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "focus_ref: ref like e1" };
      return {
        op: {
          op: "focus_ref",
          ref,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "clear_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "clear_ref: ref like e1" };
      return {
        op: {
          op: "clear_ref",
          ref,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "type_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "type_ref: ref like e1" };
      const value = String(o["value"] ?? "");
      if (value.length > 16_000) return { error: "type_ref: value too long" };
      const delay = o["delay_ms"] === undefined ? undefined : Number(o["delay_ms"]);
      if (delay !== undefined && (!Number.isFinite(delay) || delay < 0 || delay > 200)) {
        return { error: "type_ref: delay_ms 0..200" };
      }
      return {
        op: {
          op: "type_ref",
          ref,
          value,
          delay_ms: delay,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 30_000), 60_000),
        },
      };
    }
    case "press_key_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "press_key_ref: ref like e1" };
      const key = shorten(String(o["key"] ?? "").trim(), 40);
      if (!key) return { error: "press_key_ref: key required" };
      return {
        op: {
          op: "press_key_ref",
          ref,
          key,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "hover": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `hover: ${selector.error}` };
      return {
        op: {
          op: "hover",
          selector,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "hover_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "hover_ref: ref like e1" };
      return {
        op: {
          op: "hover_ref",
          ref,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "press_key": {
      const key = shorten(String(o["key"] ?? "").trim(), 40);
      if (!key) return { error: "press_key: key required" };
      return { op: { op: "press_key", key } };
    }
    case "wait_navigation": {
      const wu = o["wait_until"];
      const wait_until =
        wu === "load" || wu === "networkidle" || wu === "domcontentloaded" ? wu : "load";
      return {
        op: {
          op: "wait_navigation",
          wait_until,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 60_000),
        },
      };
    }
    case "select_option": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `select_option: ${selector.error}` };
      const value = String(o["value"] ?? "");
      return {
        op: {
          op: "select_option",
          selector,
          value,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "select_option_ref": {
      const ref = String(o["ref"] ?? "").trim();
      if (!/^e\d+$/.test(ref)) return { error: 'select_option_ref: ref like e1, and value matching an option label or value' };
      return { op: { op: "select_option_ref", ref, value: String(o["value"] ?? ""), timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000) } };
    }
    case "check": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `check: ${selector.error}` };
      return {
        op: {
          op: "check",
          selector,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "uncheck": {
      const selector = selectorField(o);
      if (typeof selector !== "string") return { error: `uncheck: ${selector.error}` };
      return {
        op: {
          op: "uncheck",
          selector,
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "screenshot": {
      return { op: { op: "screenshot", full_page: o["full_page"] === true } };
    }
    default:
      return { error: `Unknown action op "${op}"` };
  }
}

/** Some news cards put a same-destination anchor above their labelled headline.
 * Click that real hit target normally; never force through dialogs or other links. */
export async function clickBrowserControl(target: Page | Frame, locator: Locator, timeoutMs = 15000): Promise<void> {
  let count = await locator.count();
  if (!count) {
    await locator.waitFor({state:'attached',timeout:Math.min(timeoutMs,1500)}).catch(()=>{});
    count = await locator.count();
  }
  if (count !== 1) {
    const choices = await locator.evaluateAll(elements => elements.slice(0,6).map(el => ({
      tag:el.tagName.toLowerCase(),name:(el.getAttribute('aria-label')||(el as HTMLElement).innerText||'').trim().slice(0,140),
      href:el instanceof HTMLAnchorElement?el.href:undefined,visible:!!el.getClientRects().length,
    })));
    throw Error(count ? `AMBIGUOUS_TARGET: ${count} matches; no click executed. Choose the intended observed ref or destination. Candidates: ${JSON.stringify(choices)}` : 'TARGET_NOT_FOUND: no matching element appeared. No click executed; use the fresh refs or browser_extract links instead of guessing another selector.');
  }
  if (!await locator.isVisible()) {
    await locator.waitFor({state:'visible',timeout:Math.min(timeoutMs,1500)}).catch(()=>{});
    if (!await locator.isVisible()) throw Error('TARGET_NOT_VISIBLE: no click executed. Inspect the returned current controls; do not force the click.');
  }
  const isLink = await locator.evaluate(el => el instanceof HTMLAnchorElement && /^https?:/.test(el.href) && !el.hasAttribute('download'), undefined, {timeout: Math.min(timeoutMs, 2000)});
  let actual = locator;
  if (isLink) {
    await locator.scrollIntoViewIfNeeded({timeout: Math.min(timeoutMs, 2000)});
    const token = randomUUID();
    const equivalent = await locator.evaluate((el, marker) => {
      const link = el as HTMLAnchorElement, rect = link.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
      const hit = document.elementFromPoint(x, y)?.closest('a[href]');
      if (!(hit instanceof HTMLAnchorElement) || hit === link || hit.href !== link.href || hit.target !== link.target || hit.hasAttribute('download')) return false;
      if (hit.closest('dialog,[aria-modal="true"]') !== link.closest('dialog,[aria-modal="true"]')) return false;
      hit.setAttribute('data-liminal-click-target', marker); return true;
    }, token, {timeout: Math.min(timeoutMs, 2000)});
    if (equivalent) actual = target.locator(`[data-liminal-click-target="${token}"]`);
  }
  await actual.click({timeout: timeoutMs});
}

class BrowserActionError extends Error {
  constructor(message:string,readonly completedSteps:number,readonly failedStep:number,readonly op:string){super(message);}
}

export async function runBrowserActions(
  session: BrowserSession,
  ops: BrowserActOp[]
): Promise<{ urlChanged: boolean }> {
  const page = session.page;
  assertPageWithinFileRoots(page);
  let urlChanged = false;
  const navTimeoutDefault = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);

  for (let i = 0; i < ops.length; i++) {
    if (session.paused) throw new Error("User takeover is active. Resume agent control before continuing.");
    const a = ops[i]!;
    const label = `#${i + 1}:${a.op}`;
    assertPageWithinFileRoots(page);
    const urlBefore = page.url();
    try {
      switch (a.op) {
        case "reload":
          await page.reload({waitUntil:a.wait_until??"domcontentloaded",timeout:a.timeout_ms??15000});
          urlChanged=true;
          break;
        case "goto": {
          const resolved = resolveBrowseHref(a.url);
          if (!resolved.ok) throw new Error(resolved.error);
          await page.goto(resolved.href, {
            waitUntil: a.wait_until ?? "domcontentloaded",
            timeout: a.timeout_ms ?? navTimeoutDefault,
          });
          const { snapshotText, refs } = await buildPageSnapshot(page);
          session.refs = refs;
          urlChanged = true;
          break;
        }
        case "wait_ms":
          await new Promise<void>((r) => setTimeout(r, Math.min(a.ms, 120_000)));
          break;
        case "scroll": {
          const px = a.px ?? 1200;
          await page.evaluate(
            ({ d, n }) => {
              if (d === "bottom") window.scrollTo(0, document.body.scrollHeight);
              else if (d === "top") window.scrollTo(0, 0);
              else if (d === "down") window.scrollBy(0, n);
              else if (d === "up") window.scrollBy(0, -n);
            },
            { d: a.direction, n: px }
          );
          break;
        }
        case "wait_selector":
          await page.locator(a.selector).waitFor({
            state: (a.state ?? "visible") as "visible" | "attached",
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "click_selector":
          { const found=await resolveBrowserSelector(page,a.selector); await clickBrowserControl(found.target,found.locator,a.timeout_ms??15000); }
          break;
        case "click_role": {
          const loc = a.exact
            ? page.getByRole(a.role as "button", { name: a.name, exact: true })
            : page.getByRole(a.role as "button", {
                name: new RegExp(escapeRegex(a.name), "i"),
              });
          await clickBrowserControl(page,loc,a.timeout_ms??15000);
          break;
        }
        case "click_text":
          await clickBrowserControl(page,page.getByText(a.text, { exact: Boolean(a.exact) }),a.timeout_ms??15000);
          break;
        case "double_click_ref":
          await resolveRefLocator(page,a.ref,session.refs).dblclick({timeout:a.timeout_ms??15000});
          break;
        case "double_click_text":
          await page.getByText(a.text,{exact:a.exact??true}).dblclick({timeout:a.timeout_ms??15000});
          break;
        case "click_ref":
          await clickBrowserControl(session.refs.get(a.ref)?.frame??page,await resolveClickRef(page, a.ref, session.refs),a.timeout_ms??15000);
          break;
        case "check_ref":
        case "uncheck_ref":
          await resolveRefLocator(page,a.ref,session.refs).setChecked(a.op==='check_ref',{timeout:a.timeout_ms??15000});
          break;
        case "fill":
          await (await resolveBrowserSelector(page,a.selector)).locator.fill(a.value, { timeout: a.timeout_ms ?? 15_000 });
          break;
        case "fill_ref":
          await resolveRefLocator(page, a.ref, session.refs).fill(a.value, {
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "focus_ref":
          await resolveRefLocator(page, a.ref, session.refs).focus({
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "clear_ref":
          await resolveRefLocator(page, a.ref, session.refs).clear({
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "type_ref": {
          const loc = resolveRefLocator(page, a.ref, session.refs);
          await loc.focus({ timeout: a.timeout_ms ?? 15_000 });
          await loc.pressSequentially(a.value, {
            delay: a.delay_ms ?? typeDelayMs(),
            timeout: a.timeout_ms ?? 30_000,
          });
          break;
        }
        case "press_key_ref": {
          const loc = resolveRefLocator(page, a.ref, session.refs);
          await loc.focus({ timeout: a.timeout_ms ?? 15_000 });
          await page.keyboard.press(a.key);
          break;
        }
        case "hover":
          await (await resolveBrowserSelector(page,a.selector)).locator.hover({ timeout: a.timeout_ms ?? 15_000 });
          break;
        case "hover_ref":
          await resolveRefLocator(page, a.ref, session.refs).hover({
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "press_key":
          await page.keyboard.press(a.key);
          break;
        case "wait_navigation":
          await page.waitForLoadState(a.wait_until ?? "load", {
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "select_option": {
          const found=await resolveBrowserSelector(page,a.selector);
          await selectBrowserOption(found.target,found.locator,a.value,a.timeout_ms);break;
        }
        case "select_option_ref":
            await selectBrowserOption(session.refs.get(a.ref)?.frame ?? page, resolveRefLocator(page, a.ref, session.refs), a.value, a.timeout_ms);
          break;
        case "check":
          await (await resolveBrowserSelector(page,a.selector)).locator.check({ timeout: a.timeout_ms ?? 15_000 });
          break;
        case "uncheck":
          await (await resolveBrowserSelector(page,a.selector)).locator.uncheck({ timeout: a.timeout_ms ?? 15_000 });
          break;
        case "screenshot": {
          const shotPath = browserArtifactPath("shot");
          await page.screenshot({
            path: shotPath,
            fullPage: a.full_page !== false,
            type: "png",
            timeout: 45_000,
          });
          session.lastScreenshotPath = shotPath;
          break;
        }
        default:
          throw new Error(`Unsupported op`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new BrowserActionError(`browser_act step ${label} failed: ${detail}`,i,i+1,a.op);
    }
    assertPageWithinFileRoots(page);
    if (page.url() !== urlBefore) urlChanged = true;
  }
  session.currentUrl = page.url();
  touchSession(session);
  return { urlChanged };
}

export function browserArtifactPath(prefix: string, ext: "png" | "jpg" = "png"): string {
  const root = resolveWorkspaceRoot();
  const dir = path.join(root, ".agent_artifacts", "browser");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${prefix}-${Date.now()}.${ext}`);
}

export async function actOnBrowserSession(options: {
  sessionId: string;
  actions: BrowserActOp[];
  postActionWaitMs: number;
  refreshSnapshot: boolean;
  includeConsole: boolean;
  compactObservation?: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(options.sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  if (session.paused) return { ok: false, error: "User takeover is active. Wait for the user to resume agent control of this tab." };
  touchSession(session);
  try {
    return await withBrowserWall(async () => {
    const { urlChanged } = await runBrowserActions(session, options.actions);
    const postWait = defaultPostWaitForUrl(session.page.url(), options.postActionWaitMs);
    if (postWait > 0) {
      await new Promise<void>((r) => setTimeout(r, postWait));
    }
    assertPageWithinFileRoots(session.page);
    let extra = "";
    const needSnapshot = options.refreshSnapshot || urlChanged;
    if (needSnapshot) {
      const { snapshotText, refs } = await buildPageSnapshot(session.page);
      session.refs = refs;
      extra = `\n${observationFor(session,snapshotText,!options.compactObservation)}\n`;
    }
    const diag = options.includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
    const shotLine = session.lastScreenshotPath
      ? `\nSCREENSHOT_PATH: ${session.lastScreenshotPath}`
      : "";
    await publishBrowserView(session, true);
    return {
      ok: true,
      output:
        `SESSION_ID: ${options.sessionId}\nACTIONS_EXECUTED: ${options.actions.length}\nURL: ${session.currentUrl}\n${extra || "OBSERVATION_NOT_REFRESHED: requested refresh_snapshot=false; use browser_snapshot when needed."}${shotLine}${diag}`,
    };
    });
  } catch (err) {
    let error=err instanceof Error?err.message:String(err);
    if(err instanceof BrowserActionError){
      session.currentUrl=session.page.url();
      error+='\nACTION_PROGRESS: '+JSON.stringify({completed_steps:err.completedSteps,failed_step:err.failedStep,op:err.op,url:session.currentUrl});
      if(!session.page.isClosed()){
        const snapshot=await buildPageSnapshot(session.page).catch(()=>null);
        if(snapshot){session.refs=snapshot.refs;error+='\n'+observationFor(session,snapshot.snapshotText,true);}
      }
    }
    return {ok:false,error};
  }
}

/** One-shot: launch, goto, run actions, close (legacy browser_act with url only). */
export async function runOneShotBrowserAct(options: {
  href: string;
  waitUntil: WaitUntilNav;
  navTimeoutMs: number;
  actions: BrowserActOp[];
  postActionWaitMs: number;
  includeConsole: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    return await withOwnedBrowser(async (browser, signal) => {
    const context = await buildStealthContext(browser);
    const page = await context.newPage();
    const diagnostics: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
    attachDiagnostics(page, diagnostics);
    await page.goto(options.href, {
      waitUntil: options.waitUntil,
      timeout: options.navTimeoutMs,
    });
    signal.throwIfAborted();
    const session: BrowserSession = {
      sessionId: "oneshot",
      ownerTaskId: "",
      browser,
      context,
      page,
      currentUrl: options.href,
      refs: new Map(),
      diagnostics,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    await runBrowserActions(session, options.actions);
    if (options.postActionWaitMs > 0) {
      await new Promise<void>((r) => setTimeout(r, options.postActionWaitMs));
    }
    assertPageWithinFileRoots(page);
    const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 8000);
    const diag = options.includeConsole ? formatDiagnosticsOutput(diagnostics) : "";
    return { result: { ok: true as const, output: `After act:\n${text}${diag}` } };
    });
  } catch (err) {
    return {
      ok: false,
      error: playwrightInstallHint(err instanceof Error ? err.message : String(err)),
    };
  }
}

export function listBrowserSessionIdsForTask(taskId: string): string[] {
  return [...sessions.entries()]
    .filter(([, s]) => s.ownerTaskId === taskId)
    .map(([id]) => id);
}

export async function closeAllBrowserSessionsForTask(taskId: string,options?:{includePaused?:boolean}): Promise<number> {
  const ids = browserWorkspaceState(taskId).tabs.filter(tab=>options?.includePaused||!tab.paused).map(tab=>tab.sessionId);
  for (const id of ids) {
    await closeBrowserSession({ sessionId: id }).catch(() => undefined);
  }
  if(options?.includePaused)busyBrowserTasks.delete(taskId);
  return ids.length;
}

export async function closeBrowserSession(options: {
  sessionId: string;
  screenshot?: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  await hibernatingTabs.get(options.sessionId);
  const session = sessions.get(options.sessionId);
  if(!session&&dormantTabs.has(options.sessionId)){
    const owner=dormantTabs.get(options.sessionId)!.ownerTaskId;dormantTabs.delete(options.sessionId);visibleTabs.delete(options.sessionId);
    if(selectedTaskTabs.get(owner)===options.sessionId)selectedTaskTabs.delete(owner);persistBrowserTabs();return {ok:true,output:`SESSION_CLOSED: ${options.sessionId}`};
  }
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  let shotLine = "";
  try {
    await withBrowserWall(async () => {
    if (options.screenshot) {
      assertPageWithinFileRoots(session.page);
      const shotPath = browserArtifactPath("close");
      await session.page.screenshot({ path: shotPath, fullPage: true, type: "png", timeout: 45_000 });
      shotLine = `\nSCREENSHOT_PATH: ${shotPath}`;
    }
    });
  } finally {
    publishBrowserViewClosed(options.sessionId);
    sessions.delete(options.sessionId);
    visibleTabs.delete(options.sessionId);
    dormantTabs.delete(options.sessionId);
    if (selectedTaskTabs.get(session.ownerTaskId) === options.sessionId) {
      const remaining = browserWorkspaceState(session.ownerTaskId).tabs.at(-1);
      if (remaining) selectedTaskTabs.set(session.ownerTaskId, remaining.sessionId);
      else selectedTaskTabs.delete(session.ownerTaskId);
    }
    persistBrowserTabs();
    if (session.backend) await releaseBrowserPage(options.sessionId, session.page, session.backend).catch(() => undefined);
    else {
      await session.context.close().catch(() => undefined);
      await session.browser.close().catch(() => undefined);
    }
  }
  return { ok: true, output: `SESSION_CLOSED: ${options.sessionId}${shotLine}` };
}

export async function startStaticFileServer(options: {
  ownerTaskId: string;
  rootDir: string;
  entryFile?: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const rootDir = realpathSafe(options.rootDir);
  if (!fs.existsSync(rootDir)) return { ok: false, error: `Directory not found: ${rootDir}` };

  try {
    const server = createServer((req, res) => {
      let rel: string;
      try { rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"); }
      catch { res.statusCode = 400; res.end("Malformed URL"); return; }
      if (rel === "/") rel = options.entryFile ? `/${options.entryFile}` : "/index.html";
      const filePath = realpathSafe(path.resolve(rootDir, rel.replace(/^\//, "")));
      if (rel.includes("\0") || pathEscapesSandbox(rootDir, filePath) || !fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        res.statusCode = 500;
        res.end("Read error");
      });
      stream.pipe(res);
    });

    const url = await new Promise<string>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Could not bind static server"));
          return;
        }
        staticServers.push({
          server,
          ownerTaskId: options.ownerTaskId,
          rootDir,
        });
        const entry = options.entryFile ? `/${options.entryFile}` : "";
        resolve(`http://127.0.0.1:${addr.port}${entry}`);
      });
    });

    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function closeStaticServersForTask(taskId: string): Promise<void> {
  const keep: StaticServerRecord[] = [];
  for (const rec of staticServers) {
    if (rec.ownerTaskId === taskId) {
      await new Promise<void>((r) => rec.server.close(() => r()));
    } else {
      keep.push(rec);
    }
  }
  staticServers.length = 0;
  staticServers.push(...keep);
}


export function registerBrowserTurnCleanup(harness: {
  taskId: string;
  getIsRunning?:()=>boolean;
  onTurnEndCleanup?: (taskId: string) => void | Promise<void>;
}): void {
  if(registeredBrowserHarnesses.has(harness))return;
  registeredBrowserHarnesses.add(harness);
  if(harness.getIsRunning){const ref=new WeakRef(harness),taskId=harness.taskId;busyBrowserTasks.set(taskId,()=>{const current=ref.deref();if(!current){busyBrowserTasks.delete(taskId);return false;}return current.getIsRunning?.()===true;});}
  const previous=harness.onTurnEndCleanup;
  harness.onTurnEndCleanup=async id=>{await previous?.(id);for(const session of sessions.values())if(session.ownerTaskId===id)touchSession(session);};
}

let restorePromise: Promise<void> | undefined;
export function restoreBrowserWorkspace(): Promise<void> {
  restorePromise ??= (async () => {
    lockBrowserProfile();
    restoring = true;
    try {
    const workspace = readBrowserWorkspace();
    selectedTaskTabs.clear();
    for (const [owner, id] of Object.entries(workspace.selectedTabs)) selectedTaskTabs.set(owner, id);
    const saved = workspace.tabs.slice(0, 24);
    for (const tab of saved) {
      if (sessions.has(tab.sessionId) || !/^https?:\/\//.test(tab.url)) continue;
      const resolved = resolveBrowseHref(tab.url);
      if (!resolved.ok) continue;
      // A restart is not a user takeover. Preserve the user's actual pause choice.
      dormantTabs.set(tab.sessionId,{...tab,ownerTaskId:tab.ownerTaskId||'user',url:resolved.href});
    }
    } finally { restoring = false; }
    startBrowserIdleCleanup();persistBrowserTabs();
  })();
  restorePromise.catch(() => { restorePromise = undefined; });
  return restorePromise;
}

export async function controlBrowserWorkspace(action: string, sessionId?: string, url?: string, ownerTaskId?: string) {
 return withBrowserTask(ownerTaskId??(sessions.get(sessionId??'')??dormantTabs.get(sessionId??''))?.ownerTaskId??'user',()=>controlBrowserWorkspaceImpl(action,sessionId,url,ownerTaskId));
}
async function controlBrowserWorkspaceImpl(action: string, sessionId?: string, url?: string, ownerTaskId?: string) {
  const state = () => browserWorkspaceState(ownerTaskId);
  if (action === "state") return { ok: true, ...state() };
  if (action === "restore") {
    await restoreBrowserWorkspace();
    // Migrate unassigned tabs from older app versions once, through the user's
    // explicit chat workspace. Agent tools never claim arbitrary user tabs.
    if (ownerTaskId) {
      const previousSelection = selectedTaskTabs.get("user");
      for (const tab of sessions.values()) if (tab.ownerTaskId === "user") tab.ownerTaskId = ownerTaskId;
      for (const tab of dormantTabs.values()) if (tab.ownerTaskId === "user") tab.ownerTaskId = ownerTaskId;
      if (!selectedTaskTabs.has(ownerTaskId) && previousSelection && (sessions.get(previousSelection)??dormantTabs.get(previousSelection))?.ownerTaskId === ownerTaskId) {
        selectedTaskTabs.set(ownerTaskId, previousSelection);
      }
      selectedTaskTabs.delete("user");
      persistBrowserTabs();
    }
    return { ok: true, ...state() };
  }
  if (action === "open") {
    const resolved = resolveBrowseHref(url || "https://www.google.com");
    if (!resolved.ok) return resolved;
    const result = await openBrowserSession({ ownerTaskId: ownerTaskId ?? "user", href: resolved.href, waitUntil: "domcontentloaded",
      navTimeoutMs: 30_000, postWaitMs: 0, includeConsole: false, includeSnapshot: false });
    return { ...result, ...state() };
  }
  if (action === "clear_history") {
    lockBrowserProfile();
    const fsPath = path.join(browserProfileRoot(), "workspace.json");
    const data = readBrowserWorkspace(); data.history = [];
    fs.mkdirSync(browserProfileRoot(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(fsPath, JSON.stringify(data), { mode: 0o600 });
    return { ok: true, ...state() };
  }
  const record=sessions.get(sessionId??'')??dormantTabs.get(sessionId??'');
  if(!record)return {ok:false,error:'Browser tab is no longer available'};
  if(ownerTaskId&&record.ownerTaskId!==ownerTaskId)return {ok:false,error:'This browser tab belongs to another chat'};
  if(action==='hide'){visibleTabs.delete(record.sessionId);return {ok:true};}
  if(action==='close'){const result=await closeBrowserSession({sessionId:record.sessionId});return {...result,...state()};}
  if(action==='show')visibleTabs.add(record.sessionId);
  const restored=await ensureBrowserSessionActive(record.sessionId);if(!restored.ok){visibleTabs.delete(record.sessionId);return restored;}
  const session=sessions.get(record.sessionId)!;
  if (action === "navigate") {
    const result = await userNavigateBrowserSession({ sessionId: session.sessionId, href: url || "" });
    if (!result.ok) return result;
  } else if (action === "pause" || action === "resume") {
    session.paused = action === "pause";
    await publishBrowserView(session, true);
  } else if (action === "clear_site_data") {
    const cdp = await session.context.newCDPSession(session.page);
    try { await cdp.send("Storage.clearDataForOrigin", { origin: new URL(session.page.url()).origin, storageTypes: "all" }); }
    finally { await cdp.detach(); }
    await session.page.reload({ waitUntil: "domcontentloaded" });
  } else if (action === "back") await session.page.goBack({ waitUntil: "domcontentloaded" });
  else if (action === "forward") await session.page.goForward({ waitUntil: "domcontentloaded" });
  else if (action === "reload") await session.page.reload({ waitUntil: "domcontentloaded" });
  else if (action === "focus"||action==='show') {
    selectBrowserTaskTab(session.ownerTaskId, session.sessionId);
    await session.page.bringToFront();
  }
  else return { ok: false, error: "Unknown browser action" };
  if (sessions.has(session.sessionId)) await publishBrowserView(session, true);
  return { ok: true, ...state() };
}

export async function shutdownBrowserWorkspace(): Promise<void> {
  if(idleTimer){clearInterval(idleTimer);idleTimer=undefined;}
  persistBrowserTabs(); stopping = true;
  try {
    for (const s of sessions.values()) publishBrowserViewClosed(s.sessionId);
    await shutdownBrowserProfile();
    sessions.clear();
    dormantTabs.clear();
    visibleTabs.clear();busyBrowserTasks.clear();wakingTabs.clear();
    for (const server of staticServers) server.server.close();
    staticServers.length = 0;
  } finally { stopping = false; restorePromise = undefined; }
}

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

export type CaptchaType = "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile";

export interface CaptchaSignal {
  type: CaptchaType;
  siteKey: string | null;
  pageUrl: string;
}

export async function detectCaptchaSignals(page: Page): Promise<CaptchaSignal | null> {
  assertPageWithinFileRoots(page);
  try {
    const result = await page.evaluate((): { type: string; siteKey: string | null } | null => {
      // Cloudflare Turnstile — check before generic data-sitekey
      const tsEl = document.querySelector<HTMLElement>(".cf-turnstile,[data-cf-turnstile]");
      if (tsEl || document.querySelector('script[src*="challenges.cloudflare.com"]')) {
        const sk = tsEl?.getAttribute("data-sitekey") || null;
        return { type: "turnstile", siteKey: sk };
      }
      // hCaptcha
      const hcEl = document.querySelector<HTMLElement>(".h-captcha,[data-hcaptcha-sitekey]");
      if (hcEl || document.querySelector('script[src*="hcaptcha.com"]')) {
        const sk = hcEl?.getAttribute("data-sitekey") || hcEl?.getAttribute("data-hcaptcha-sitekey") || null;
        return { type: "hcaptcha", siteKey: sk };
      }
      // reCAPTCHA v3 — invisible, identified by script or grecaptcha.execute usage
      if (document.querySelector('script[src*="recaptcha"][src*="v3"],script[src*="recaptcha/api.js?render"]')) {
        const siteKeyMatch = Array.from(document.querySelectorAll("script"))
          .map((s) => s.src)
          .join(" ")
          .match(/render=([A-Za-z0-9_-]{30,})/);
        return { type: "recaptcha_v3", siteKey: siteKeyMatch?.[1] ?? null };
      }
      // reCAPTCHA v2 — visible widget or invisible checkbox
      const rcEl = document.querySelector<HTMLElement>(".g-recaptcha,[data-sitekey]");
      if (rcEl || document.querySelector('script[src*="recaptcha"]')) {
        return { type: "recaptcha_v2", siteKey: rcEl?.getAttribute("data-sitekey") || null };
      }
      // Iframe-based detection (after DOM patching)
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"]'
      );
      if (iframe) {
        const src = iframe.src;
        if (src.includes("hcaptcha")) return { type: "hcaptcha", siteKey: null };
        if (src.includes("challenges.cloudflare")) return { type: "turnstile", siteKey: null };
        return { type: "recaptcha_v2", siteKey: null };
      }
      return null;
    });
    if (!result || !result.type) return null;
    return { type: result.type as CaptchaType, siteKey: result.siteKey, pageUrl: page.url() };
  } catch {
    return null;
  }
}

export function formatCaptchaHint(signal: CaptchaSignal): string {
  const skNote = signal.siteKey ? `site_key="${signal.siteKey}"` : "site_key=(auto-detected by captcha_solve)";
  return (
    `\n[CAPTCHA DETECTED: type=${signal.type}, ${skNote}]\n` +
    `→ Call captcha_solve(type="${signal.type}", site_key="${signal.siteKey ?? ""}", page_url="${signal.pageUrl}")\n` +
    `→ Then browser_act to submit the form after injection.\n`
  );
}

/** Inject a solved CAPTCHA token into the page DOM and fire the required events. */
export async function injectCaptchaToken(
  sessionId: string,
  type: CaptchaType,
  token: string
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    await session.page.evaluate(
      ({ t, tok }: { t: string; tok: string }) => {
        function fireEvents(el: Element) {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (t === "recaptcha_v2" || t === "recaptcha_v3") {
          // Set all known response fields
          for (const sel of [
            "#g-recaptcha-response",
            'textarea[name="g-recaptcha-response"]',
            '[name="g-recaptcha-response"]',
          ]) {
            const el = document.querySelector<HTMLTextAreaElement>(sel);
            if (el) { el.value = tok; el.style.display = "block"; fireEvents(el); }
          }
          // Trigger grecaptcha callback if present
          const w = window as Window & { grecaptcha?: { enterprise?: { getResponse?: () => string } }; __recaptchaCallback?: (t: string) => void };
          if (w.__recaptchaCallback) w.__recaptchaCallback(tok);
        } else if (t === "hcaptcha") {
          for (const sel of ['[name="h-captcha-response"]', 'textarea[name="h-captcha-response"]']) {
            const el = document.querySelector<HTMLTextAreaElement>(sel);
            if (el) { el.value = tok; fireEvents(el); }
          }
          // hCaptcha callback
          const hEl = document.querySelector<HTMLElement>("[data-callback]");
          const cb = hEl?.getAttribute("data-callback");
          if (cb) {
            const fn = (window as unknown as Record<string, unknown>)[cb];
            if (typeof fn === "function") (fn as (t: string) => void)(tok);
          }
        } else if (t === "turnstile") {
          for (const sel of ['[name="cf-turnstile-response"]', 'input[name="cf-turnstile-response"]']) {
            const el = document.querySelector<HTMLInputElement>(sel);
            if (el) { el.value = tok; fireEvents(el); }
          }
          // Turnstile callback
          const tsEl = document.querySelector<HTMLElement>(".cf-turnstile,[data-cf-turnstile]");
          const cb = tsEl?.getAttribute("data-callback");
          if (cb) {
            const fn = (window as unknown as Record<string, unknown>)[cb];
            if (typeof fn === "function") (fn as (t: string) => void)(tok);
          }
        }
      },
      { t: type, tok: token }
    );
    return { ok: true, output: `CAPTCHA_INJECTED: type=${type}, token_length=${token.length}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Wait-for conditions ───────────────────────────────────────────────────────

export async function waitForInSession(
  sessionId: string,
  opts: {
    condition: "selector" | "selector_hidden" | "text" | "url_contains" | "network_idle";
    selector?: string;
    text?: string;
    urlPattern?: string;
    timeoutMs?: number;
  }
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  const timeout = Math.min(opts.timeoutMs ?? 15_000, 120_000);
  try {
    return await withBrowserWall(async () => {
      switch (opts.condition) {
        case "selector": {
          if (!opts.selector) return { ok: false, error: "selector required for condition=selector" };
          await session.page.locator(opts.selector).first().waitFor({ state: "visible", timeout });
          return { ok: true, output: `WAIT_MET: selector "${opts.selector}" is visible` };
        }
        case "selector_hidden": {
          if (!opts.selector) return { ok: false, error: "selector required for condition=selector_hidden" };
          await session.page.locator(opts.selector).first().waitFor({ state: "hidden", timeout });
          return { ok: true, output: `WAIT_MET: selector "${opts.selector}" is hidden` };
        }
        case "text": {
          if (!opts.text) return { ok: false, error: "text required for condition=text" };
          await session.page.getByText(opts.text, { exact: false }).first().waitFor({ state: "visible", timeout });
          return { ok: true, output: `WAIT_MET: text "${opts.text}" found on page` };
        }
        case "url_contains": {
          if (!opts.urlPattern) return { ok: false, error: "url_pattern required for condition=url_contains" };
          const pattern = opts.urlPattern;
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            if (session.page.url().includes(pattern)) {
              session.currentUrl = session.page.url();
              return { ok: true, output: `WAIT_MET: URL contains "${pattern}" → ${session.currentUrl}` };
            }
            await new Promise<void>((r) => setTimeout(r, 200));
          }
          return { ok: false, error: `Timeout waiting for URL to contain "${pattern}" (current: ${session.page.url()})` };
        }
        case "network_idle": {
          await session.page.waitForLoadState("networkidle", { timeout });
          session.currentUrl = session.page.url();
          return { ok: true, output: `WAIT_MET: network idle at ${session.currentUrl}` };
        }
        default:
          return { ok: false, error: `Unknown condition "${(opts as { condition: string }).condition}"` };
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Structured data extraction ────────────────────────────────────────────────

export type ExtractType =
  | "tables"
  | "links"
  | "text"
  | "forms"
  | "selector_text"
  | "selector_html"
  | "meta"
  | "headings";

export async function extractFromSession(
  sessionId: string,
  type: ExtractType,
  selector?: string,
  includeHidden = false,
  query?: string,
  readingWindow?: {offset?: number; maxChars?: number; includeSource?: boolean}
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    assertPageWithinFileRoots(session.page);
    if(type==='forms'){
      const forms:Record<string,unknown>[]=[];
      for(const frame of session.page.frames()){
        if(frame!==session.page.mainFrame()){const host=await frame.frameElement().catch(()=>null);if(!host||!await host.isVisible().catch(()=>false))continue;}
        const observed=await frame.evaluate(({hidden})=>{
          const roots:(Document|ShadowRoot)[]=[document];
          for(let i=0;i<roots.length;i++)for(const el of roots[i]!.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
          const controls=roots.flatMap(root=>[...root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,textarea,select')]).filter(el=>hidden||el.type!=='hidden'&&el.getClientRects().length>0&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));
          const groups=new Map<HTMLFormElement|null,typeof controls>();
          for(const el of controls){const group=groups.get(el.form)??[];group.push(el);groups.set(el.form,group);}
          return [...groups].map(([form,fields])=>({action:form?.action??null,method:form?.method??null,unowned:form===null,fields:fields.map(el=>({
            tag:el.tagName.toLowerCase(),type:el.type,name:el.name||null,id:el.id||null,label:el.getAttribute('aria-label')||[...(el.labels??[])].map(label=>label.textContent?.trim()).join(' ')||null,
            placeholder:el.getAttribute('placeholder'),value:el.type==='password'?null:el.value||null,password_filled:el.type==='password'?!!el.value:undefined,required:el.required,disabled:el.disabled,
            checked:el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)?el.checked:undefined,
            options:el instanceof HTMLSelectElement?[...el.options].map(o=>({label:o.label,value:o.value,selected:o.selected})):undefined,validation:!el.validity.valid?el.validationMessage:null,
          }))}));
        },{hidden:includeHidden});
        forms.push(...observed.map(form=>({...form,frame_origin:new URL(frame.url()).origin})));
      }
      return {ok:true,output:JSON.stringify(forms,null,2)};
    }
    const observed = await browserDeadline(() => session.page.evaluate(
      ({ ty, sel, hidden, query, sourced, namespace, token }: { ty: string; sel: string | undefined; hidden: boolean; query?:string;sourced:boolean;namespace:string;token:string }) => {
        function extract() {
        const visibility=new WeakMap<Element,boolean>();
        function vis(el: Element): boolean {
          if (hidden) return true;
          const cached=visibility.get(el);if(cached!==undefined)return cached;
          const s = window.getComputedStyle(el);
          const shown=(el.getClientRects().length>0||s.display==='contents')&&!el.matches('[hidden],[inert],[aria-hidden="true"]')&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&(!el.parentElement||vis(el.parentElement));
          visibility.set(el,shown);return shown;
        }
        const textVisibility=new WeakMap<Element,boolean>();
        function textVisible(el:Element):boolean{
          if(hidden)return true;
          const cached=textVisibility.get(el);if(cached!==undefined)return cached;
          const s=getComputedStyle(el);
          const shown=(el.getClientRects().length>0||s.display==='contents')&&!el.matches('[hidden],[inert]')&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&(!el.parentElement||textVisible(el.parentElement));
          textVisibility.set(el,shown);return shown;
        }
        const folded=(text:string)=>text.normalize('NFKC').replace(/[\u2010-\u2015\u2212-]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
        const queryTerms=[...new Set(folded(query??'').match(/[\p{L}\p{N}]+/gu)??[])];
        const allTerms=(text:string)=>{
          const words=new Set(folded(text).match(/[\p{L}\p{N}]+/gu)??[]);
          return queryTerms.length>=2&&queryTerms.every(term=>words.has(term));
        };
        function renderedText(root:Node,range?:Range):string {
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),pieces:string[]=[];
          let previous:Element|null=null,lastStrike:Element|null=null;
          for(let node=walker.nextNode();node;node=walker.nextNode()){
            const parent=node.parentElement,text=node.textContent?.replace(/\s+/g,' ').trim();
            if(!parent||!text||parent.closest('select,option,script,style,noscript')||!textVisible(parent)||range&&!range.intersectsNode(node))continue;
            const block=parent.closest('p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,article,section,main,body');
            let strike=parent.closest('del,s,strike');
            if(!strike)for(let el:Element|null=parent;el;el=el.parentElement){if(getComputedStyle(el).textDecorationLine.includes('line-through')){strike=el;break;}}
            pieces.push((pieces.length?(block===previous?' ':'\n'):'')+(strike&&strike!==lastStrike?'[struck through] ':'')+text);
            previous=block;lastStrike=strike;
          }
          return pieces.join('');
        }
        let linkIndex = 0;
        function linksFrom(elements: HTMLAnchorElement[]) {
          const unique = new Map<string, {text:string;href:string;context?:string;selector?:string}>();
          const state = window as unknown as Record<string,WeakMap<Element,string>>;
          if (sourced && !state[namespace]) Object.defineProperty(state,namespace,{value:new WeakMap<Element,string>()});
          for (const a of elements.filter(vis)) {
            const text=a.innerText.trim().replace(/\s+/g,' ').slice(0,160), href=a.href;
            const before=unique.get(href);
            if (before) { if(!before.text && text)before.text=text; continue; }
            let selector: string | undefined;
            if(sourced){
              const marker=state[namespace]!.get(a)??token+'-'+(linkIndex++);
              state[namespace]!.set(a,marker);a.setAttribute('data-liminal-ref',marker);
              selector='[data-liminal-ref="'+marker+'"]';
            }
            unique.set(href,{text,href,...(selector?{selector}:{}),context:a.closest('p,li')?.textContent?.trim().replace(/\s+/g,' ').slice(0,240)});
          }
          return [...unique.values()];
        }
        if (ty === "tables") {
          const scope=sel?document.querySelector(sel):document;
          const tables=(scope instanceof HTMLTableElement?[scope]:[...scope?.querySelectorAll('table')??[]]).filter(textVisible);
          const results:unknown[]=[];
          for(const [tableIndex,table]of tables.entries()){
            const rows=[...table.rows].filter(textVisible),grid:string[][]=[];
            const caption=table.caption?.textContent?.trim()??null;
            let headers:string[]=[];
            for(const [rowIndex,row]of rows.entries()){
              const values=grid[rowIndex]??(grid[rowIndex]=[]);let column=0;
              for(const cell of [...row.cells].filter(textVisible)){
                while(values[column]!==undefined)column++;
                const text=renderedText(cell).trim().replace(/\s+/g,' ');
                const height=cell.rowSpan===0?rows.length-rowIndex:Math.min(cell.rowSpan,rows.length-rowIndex);
                const width=Math.min(cell.colSpan,64);
                for(let down=0;down<height;down++)for(let across=0;across<width;across++)(grid[rowIndex+down]??(grid[rowIndex+down]=[]))[column+across]=text;
                column+=width;
              }
              const header=table.tHead?.contains(row)||rowIndex===0&&[...row.cells].every(cell=>cell.tagName==='TH');
              if(header){headers=[...values];continue;}
              const text=values.map((value,i)=>`${headers[i]||'Column '+(i+1)}: ${value??''}`).join('\n');
              const exact=!query?.trim()||folded(text).includes(folded(query));
              if(sourced&&(exact||allTerms(text)))results.push({table:tableIndex,caption,row:rowIndex,text,...(!exact?{match_kind:'all_terms'}:{})});
            }
            if(!sourced)results.push({caption,rows:grid});
          }
          if(sourced&&query?.trim()&&results.some(row=>!(row as {match_kind?:string}).match_kind))
            return results.filter(row=>!(row as {match_kind?:string}).match_kind);
          return results;
        }
        if (ty === "links") {
          return linksFrom(Array.from((sel?document.querySelector(sel):document)?.querySelectorAll<HTMLAnchorElement>("a[href]")??[]))
            .filter((l) => (l.text || l.href)&&(!query?.trim()||[l.text,l.href,l.context].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
        }
        if (ty === "text") {
          const root = sel ? document.querySelector(sel) : [...document.querySelectorAll('main,[role="main"]')].find(vis)??[...document.querySelectorAll('article')].find(vis)??document.body;
          if(!root)return "";
          const raw=renderedText(root).replace(/[^\S\r\n]+/g," ").trim();
          const headings=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(textVisible);
          if(query?.trim()){
            const needle=folded(query);
            const headingMatches=headings.filter(el=>folded((el as HTMLElement).innerText).includes(needle));
            let matches=(headingMatches.length?headingMatches:[...root.querySelectorAll('*')].filter(el=>textVisible(el)&&!el.closest('select,option,script,style')&&folded(renderedText(el)).includes(needle)&&![...el.children].some(child=>folded(renderedText(child)).includes(needle)))).slice(0,20);
            const fallback=matches.length===0;
            if(fallback)matches=[...root.querySelectorAll('p,td,th,li,h1,h2,h3,h4,h5,h6,[role="paragraph"]')].filter(el=>textVisible(el)&&allTerms(renderedText(el))&&![...el.querySelectorAll('p,td,th,li')].some(child=>allTerms(renderedText(child)))).slice(0,20);
            if(!matches.length)return {matches:[],available_headings:headings.slice(0,30).map(h=>(h as HTMLElement).innerText.trim())};
            return matches.map(el=>{
              const hierarchy:{level:number;heading:string}[]=[];
              for(const heading of headings){
                if(!(heading.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
                const level=Number(heading.getAttribute('aria-level')??heading.tagName.slice(1))||2;
                while(hierarchy.length&&hierarchy.at(-1)!.level>=level)hierarchy.pop();
                hierarchy.push({level,heading:(heading as HTMLElement).innerText.trim()});
              }
              const local=(el.closest('tr,[role="row"],article,[role="listitem"],li')??el.parentElement?.parentElement??el.parentElement??el) as HTMLElement;
              if(headings.includes(el)){
                const level=Number(el.getAttribute('aria-level')??el.tagName.slice(1))||2;
                const next=headings.find(h=>(el.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING)&&Number(h.getAttribute('aria-level')??h.tagName.slice(1))<=level);
                const range=document.createRange();range.setStartAfter(el);if(next)range.setEndBefore(next);else range.setEnd(root,root.childNodes.length);
                const fragment=range.cloneContents();
                const section=renderedText(range.commonAncestorContainer,range);
                return {headingPath:[...hierarchy.map(h=>h.heading),(el as HTMLElement).innerText.trim()],text:(el as HTMLElement).innerText.trim(),nearbyText:sourced?section:section.slice(0,4000),links:linksFrom([...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a=>range.intersectsNode(a))).slice(0,4)};
              }
              return {headingPath:hierarchy.map(h=>h.heading),text:renderedText(el).trim(),nearbyText:sourced?renderedText(local):renderedText(local).slice(0,1600),...(fallback?{match_kind:'all_terms'}:{}),links:linksFrom([...local.querySelectorAll<HTMLAnchorElement>('a[href]')]).slice(0,4)};
            });
          }
          const labels=new Map(headings.map(el=>[(el as HTMLElement).innerText.trim(),Number(el.getAttribute('aria-level')??el.tagName.slice(1))||2]));
          return raw.split('\n').map(line=>labels.has(line.trim())?'#'.repeat(labels.get(line.trim())!)+' '+line.trim():line).join('\n');
        }
        if (ty === "selector_text") {
          if (!sel) return null;
          const els = Array.from(document.querySelectorAll(sel)).filter(textVisible);
          return els.map((e) => {
            const text=renderedText(e).trim().replace(/\s+/g, " ");
            if(!sourced)return text;
            const links=linksFrom([...(e.matches('a[href]')?[e as HTMLAnchorElement]:[]),...e.querySelectorAll<HTMLAnchorElement>('a[href]')]).slice(0,4);
            return {text,links};
          });
        }
        if (ty === "selector_html") {
          if (!sel) return null;
          const els = Array.from(document.querySelectorAll(sel)).filter(vis);
          return els.map((e) => e.outerHTML.slice(0, 8000));
        }
        if (ty === "meta") {
          const metas: Record<string, string> = {};
          document.querySelectorAll("meta").forEach((m) => {
            const name = m.getAttribute("name") || m.getAttribute("property") || m.getAttribute("http-equiv");
            const content = m.getAttribute("content");
            if (name && content) metas[name] = content.slice(0, 500);
          });
          return {
            title: document.title,
            description: metas["description"] || metas["og:description"] || null,
            canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
            metas,
          };
        }
        if (ty === "headings") {
          return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .filter(vis)
            .map((h) => ({
              level: parseInt(h.tagName[1]!, 10),
              text: (h as HTMLElement).innerText.trim().replace(/\s+/g, " ").slice(0, 300),
            }));
        }
        return null;
        }
        const data=extract();
        const search=/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(location.hostname)&&(new URL(location.href).searchParams.has('q')||location.pathname.includes('/search'));
        return {source:{url:location.href,title:document.title,observed_at:new Date().toISOString(),kind:search?'search_lead':'page_observation'},data};
      },
      { ty: type, sel: selector, hidden: includeHidden, query,sourced:readingWindow?.includeSource===true,namespace:domRefNamespace,token:randomUUID() }
    ), 5000, 'Page extraction');
    const result=readingWindow?.includeSource ? compactExtractedLinks(observed.data,(selector,name,href)=>{
      const frame=session.page.mainFrame();let known=frameNodeRefs.get(frame);
      if(!known){known=new Map();frameNodeRefs.set(frame,known);}
      const id=known.get(selector)??'e'+(++snapshotRefCounter);known.set(selector,id);
      session.refs.set(id,{role:'link',name,exact:true,selector,frame,href,observedUrl:frame.url()});return id;
    }) : observed.data;
    const output=(data:unknown)=>{
      if(!readingWindow?.includeSource)return JSON.stringify(data);
      let checkpoint: string | undefined;
      try{checkpoint=saveBrowserResearchCheckpoint(session.ownerTaskId,{source:observed.source,data});}catch{/* Keep reading usable in a read-only workspace. */}
      return JSON.stringify({source:observed.source,data,...(checkpoint?{checkpoint}:{})});
    };
    if(readingWindow&&type==='text'&&!query&&typeof result==='string'){
      if(readingWindow.includeSource)return {ok:true,output:output(pageExtractedText(result,readingWindow))};
      const offset=Math.max(0,Math.floor(readingWindow.offset??0));
      const limit=Math.max(500,Math.min(6000,Math.floor(readingWindow.maxChars??5000)));
      const text=result.slice(offset,offset+limit),next=offset+text.length;
      if(offset>0&&offset>=result.length)throw new Error(`offset=${offset} is outside ${result.length} characters. Start at 0 or use next_offset.`);
      return {ok:true,output:output({url:observed.source.url,offset,offset_unit:'characters',total_chars:result.length,next_offset:next<result.length?next:null,text})};
    }
    if(readingWindow&&type==='links'&&Array.isArray(result)){
      const page=pageExtractedItems(result,readingWindow);
      const {items:links,...metadata}=page;
      return {ok:true,output:output({...metadata,links})};
    }
    if(readingWindow?.includeSource&&Array.isArray(result)&&['text','selector_text','selector_html','headings','tables'].includes(type))
      return {ok:true,output:output(pageExtractedItems(result,readingWindow,type==='selector_text'))};
    return { ok: true, output: output(result) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Cookie management ─────────────────────────────────────────────────────────

function cookieProfilePath(profile: string): string {
  const root = resolveWorkspaceRoot();
  const dir = path.join(root, ".agent_artifacts", "browser_cookies");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const safe = profile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  const file = path.join(dir, `${safe}.json`);
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  return file;
}

export async function getSessionCookies(
  sessionId: string
): Promise<{ ok: true; output: string; cookies: unknown[] } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    const cookies = await session.context.cookies([session.page.url()]);
    return { ok: true, output: JSON.stringify(cookies, null, 2), cookies };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addSessionCookies(
  sessionId: string,
  cookies: unknown[]
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    await session.context.addCookies(cookies as Parameters<BrowserContext["addCookies"]>[0]);
    return { ok: true, output: `COOKIES_ADDED: ${cookies.length} cookie(s) set` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearSessionCookies(
  sessionId: string
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    const cookies = await session.context.cookies([session.page.url()]);
    for (const cookie of cookies) await session.context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path });
    return { ok: true, output: "COOKIES_CLEARED" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveCookieProfile(
  sessionId: string,
  profile: string
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const got = await getSessionCookies(sessionId);
  if (!got.ok) return got;
  const p = cookieProfilePath(profile);
  fs.writeFileSync(p, JSON.stringify(got.cookies, null, 2), { encoding: "utf8", mode: 0o600 });
  return { ok: true, output: `COOKIES_SAVED: ${got.cookies.length} cookie(s) → ${p}` };
}

export async function loadCookieProfile(
  sessionId: string,
  profile: string
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const p = cookieProfilePath(profile);
  if (!fs.existsSync(p)) return { ok: false, error: `Cookie profile not found: "${profile}" (${p})` };
  let cookies: unknown[];
  try {
    cookies = JSON.parse(fs.readFileSync(p, "utf8")) as unknown[];
  } catch (err) {
    return { ok: false, error: `Failed to parse cookie profile: ${err instanceof Error ? err.message : String(err)}` };
  }
  return addSessionCookies(sessionId, cookies);
}

export function listCookieProfiles(): string[] {
  const dir = path.join(resolveWorkspaceRoot(), ".agent_artifacts", "browser_cookies");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** Detect CAPTCHA in an existing session by ID (for captcha_solve auto-detection). */
export async function detectCaptchaInBrowserSession(
  sessionId: string
): Promise<CaptchaSignal | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;
  touchSession(session);
  return detectCaptchaSignals(session.page);
}
