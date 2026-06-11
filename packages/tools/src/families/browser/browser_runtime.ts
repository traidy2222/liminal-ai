/**
 * Playwright browser session runtime — shared by browser_* tools.
 * Sessions persist across tool calls within a harness turn until close or turn_end cleanup.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { effectiveHarnessEnvRaw, resolveWorkspaceRoot } from "@liminal/core";
import type { Page, Browser, BrowserContext } from "playwright";
import {
  startBrowserScreencast,
  stopBrowserScreencastForSession,
} from "./browser_screencast.js";

export type WaitUntilNav = "domcontentloaded" | "load" | "networkidle";

export interface SnapshotRef {
  role: string;
  name: string;
  exact?: boolean;
  /** CSS selector from DOM fallback (preferred for click_ref when present). */
  selector?: string;
}

type A11yNode = {
  role?: string;
  name?: string;
  value?: string;
  children?: A11yNode[];
};

export type BrowserActOp =
  | { op: "wait_ms"; ms: number }
  | { op: "scroll"; direction: "bottom" | "top" | "down" | "up"; px?: number }
  | { op: "wait_selector"; selector: string; state?: "visible" | "attached"; timeout_ms?: number }
  | { op: "click_selector"; selector: string; timeout_ms?: number }
  | { op: "click_role"; role: string; name: string; exact?: boolean; timeout_ms?: number }
  | { op: "click_text"; text: string; exact?: boolean; timeout_ms?: number }
  | { op: "click_ref"; ref: string; timeout_ms?: number }
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
}

const sessions = new Map<string, BrowserSession>();

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
  if (!browserEmbedEnabled()) return;
  let imagePath: string | undefined;
  let title: string | undefined;
  if (open) {
    title = (await session.page.title().catch(() => "")) || undefined;
    const buf = await capturePanelFrame(session.page);
    if (buf) {
      panelFrames.set(session.sessionId, buf);
      try {
        const shotPath = browserArtifactPath("panel", "jpg");
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
  if (open && effectiveHarnessEnvRaw("AGENT_BROWSER_EMBED_MODE") === "screencast") {
    void startBrowserScreencast(session.sessionId).catch(() => undefined);
  }
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
    liveStream: open && effectiveHarnessEnvRaw("AGENT_BROWSER_EMBED_MODE") === "screencast",
    embedMode:
      effectiveHarnessEnvRaw("AGENT_BROWSER_EMBED_MODE") === "screencast"
        ? "screencast"
        : "webview",
  });
}

function publishBrowserViewClosed(sessionId: string): void {
  void stopBrowserScreencastForSession(sessionId);
  panelFrames.delete(sessionId);
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
    .split(/[;:]/)
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
  const con = b.consoleMsgs.slice(-30).join("\n") || "(none)";
  const pe = b.pageErrors.length
    ? b.pageErrors.slice(-12).join("\n\n--- page error ---\n\n")
    : "(none)";
  const fr = b.failedReqs.slice(-20).join("\n") || "(none)";
  return (
    `\nCONSOLE:\n${con}\nPAGE_ERRORS:\n${pe}\nFAILED_REQUESTS:\n${fr}`
  );
}

function maxSessionsPerTask(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_BROWSER_MAX_SESSIONS") ?? "2", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 2;
}

function sessionTtlMs(): number {
  return parseHarnessMs("AGENT_BROWSER_SESSION_TTL_MS", 120_000, 600_000);
}

function evictStaleSessions(): void {
  const ttl = sessionTtlMs();
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsedAt > ttl) {
      void closeBrowserSession({ sessionId: id }).catch(() => undefined);
    }
  }
}

function countSessionsForTask(taskId: string): number {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.ownerTaskId === taskId) n++;
  }
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

type DomSnapshotItem = { role: string; name: string; selector: string };

function walkA11yInteractive(
  node: A11yNode,
  refs: Map<string, SnapshotRef>,
  refLines: string[],
  nextRef: () => string,
  depth: number
): void {
  if (depth > 24) return;
  const role = (node.role ?? "").toLowerCase();
  const name = (node.name ?? node.value ?? "").trim();
  if (role && name && INTERACTIVE_ROLES.has(role)) {
    const id = nextRef();
    refs.set(id, { role, name, exact: true });
    refLines.push(`  ${id} ${role} "${name.replace(/"/g, "'")}"`);
  }
  for (const child of node.children ?? []) {
    walkA11yInteractive(child, refs, refLines, nextRef, depth + 1);
  }
}

async function buildDomSnapshotRefs(page: Page, maxItems = 48): Promise<DomSnapshotItem[]> {
  return page.evaluate((limit) => {
    const INTERACTIVE = new Set([
      "button",
      "link",
      "textbox",
      "checkbox",
      "radio",
      "combobox",
      "searchbox",
      "tab",
      "switch",
    ]);

    function visible(el: Element): boolean {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function accName(el: Element): string {
      const a =
        el.getAttribute("aria-label")?.trim() ||
        (el as HTMLElement).innerText?.trim().slice(0, 120) ||
        el.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ||
        el.getAttribute("placeholder")?.trim() ||
        el.getAttribute("title")?.trim() ||
        el.getAttribute("name")?.trim() ||
        el.getAttribute("value")?.trim() ||
        "";
      return a.replace(/\s+/g, " ");
    }

    function inferRole(el: Element): string {
      const explicit = el.getAttribute("role")?.toLowerCase();
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a") return "link";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "input") {
        const t = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "search") return "searchbox";
        return "textbox";
      }
      return "button";
    }

    function cssPath(el: Element): string {
      const id = el.getAttribute("id");
      if (id && /^[a-zA-Z][\w-]*$/.test(id)) return `#${id}`;
      const testId = el.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      const name = el.getAttribute("name");
      if (name && el.tagName.toLowerCase() === "input") {
        return `input[name="${name.replace(/"/g, '\\"')}"]`;
      }
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 5) {
        let part = cur.tagName.toLowerCase();
        if (cur.parentElement) {
          const sibs = [...cur.parentElement.children].filter((c) => c.tagName === cur!.tagName);
          if (sibs.length > 1) {
            part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }

    const nodes = document.querySelectorAll(
      'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [contenteditable="true"]'
    );
    const out: DomSnapshotItem[] = [];
    const seen = new Set<string>();
    for (const el of nodes) {
      if (!visible(el)) continue;
      const role = inferRole(el);
      if (!INTERACTIVE.has(role)) continue;
      const name = accName(el);
      if (!name || name.length < 1) continue;
      const selector = cssPath(el);
      const key = `${role}|${name}|${selector}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role, name: name.slice(0, 200), selector });
      if (out.length >= limit) break;
    }
    return out;
  }, maxItems);
}

async function tryLegacyA11ySnapshot(page: Page): Promise<A11yNode | null> {
  const legacy = page as Page & {
    accessibility?: { snapshot: (o: { interestingOnly: boolean }) => Promise<A11yNode | null> };
  };
  if (!legacy.accessibility?.snapshot) return null;
  try {
    return await legacy.accessibility.snapshot({ interestingOnly: true });
  } catch {
    return null;
  }
}

async function tryAriaSnapshotYaml(page: Page): Promise<string | null> {
  const loc = page.locator("body");
  const withAria = loc as typeof loc & { ariaSnapshot?: () => Promise<string> };
  if (typeof withAria.ariaSnapshot !== "function") return null;
  try {
    const yaml = await withAria.ariaSnapshot();
    return yaml?.trim() ? yaml.trim() : null;
  } catch {
    return null;
  }
}

export async function buildPageSnapshot(
  page: Page,
  maxChars = 10_000
): Promise<{ snapshotText: string; refs: Map<string, SnapshotRef> }> {
  const refs = new Map<string, SnapshotRef>();
  const refLines: string[] = [];
  let counter = 0;
  const nextRef = () => {
    counter += 1;
    return `e${counter}`;
  };

  let treeBlock = "";
  const snap = await tryLegacyA11ySnapshot(page);
  if (snap) {
    walkA11yInteractive(snap, refs, refLines, nextRef, 0);
    treeBlock = JSON.stringify(snap, null, 0).slice(0, Math.max(2000, maxChars - 1200));
  } else {
    const ariaYaml = await tryAriaSnapshotYaml(page);
    treeBlock = ariaYaml
      ? ariaYaml.slice(0, Math.max(2000, maxChars - 1200))
      : "(legacy accessibility API unavailable — using DOM snapshot)";
  }

  const domItems = await buildDomSnapshotRefs(page).catch(() => [] as DomSnapshotItem[]);
  for (const item of domItems) {
    const id = nextRef();
    refs.set(id, {
      role: item.role,
      name: item.name,
      exact: false,
      selector: item.selector,
    });
    const selHint = item.selector.length > 60 ? `${item.selector.slice(0, 57)}…` : item.selector;
    const comboboxHint = item.role === "combobox" ? " (use type_ref + press_key Enter)" : "";
    refLines.push(
      `  ${id} ${item.role} "${item.name.replace(/"/g, "'")}" sel=${selHint}${comboboxHint}`
    );
  }

  const lines = [
    "SNAPSHOT_REFS (use click_ref / fill_ref / hover_ref, or click_selector with sel=):",
    ...(refLines.length ? refLines : ["  (no interactive refs — try wait_ms, scroll, or click_selector)"]),
    "",
    "A11Y_TREE_EXCERPT:",
    treeBlock,
  ];
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…(snapshot truncated)";
  return { snapshotText: text, refs };
}

function touchSession(s: BrowserSession): void {
  s.lastUsedAt = Date.now();
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
}): Promise<{ ok: true; sessionId: string; output: string } | { ok: false; error: string }> {
  evictStaleSessions();
  if (countSessionsForTask(options.ownerTaskId) >= maxSessionsPerTask()) {
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

  try {
    return await withBrowserWall(async () => {
    const browser = await launchBrowser();
    const context = await buildStealthContext(browser, options.viewport, options.userAgent);
    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(30_000, options.navTimeoutMs));
    page.setDefaultNavigationTimeout(options.navTimeoutMs);

    const diagnostics: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
    if (options.includeConsole) attachDiagnostics(page, diagnostics);

    await page.goto(options.href, {
      waitUntil: options.waitUntil,
      timeout: options.navTimeoutMs,
    });
    if (options.postWaitMs > 0) {
      await new Promise<void>((r) => setTimeout(r, options.postWaitMs));
    }

    const sessionId = randomUUID();
    const session: BrowserSession = {
      sessionId,
      ownerTaskId: options.ownerTaskId,
      browser,
      context,
      page,
      currentUrl: page.url(),
      refs: new Map(),
      diagnostics,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    sessions.set(sessionId, session);

    const title = await page.title();
    const body = (await page.innerText("body").catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 4000);

    let snapshotBlock = "";
    if (options.includeSnapshot) {
      const { snapshotText, refs } = await buildPageSnapshot(page);
      session.refs = refs;
      snapshotBlock = `\n${snapshotText}\n`;
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
      `SESSION_ID: ${sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}\nBODY_EXCERPT:\n${body}` +
      snapshotBlock +
      captchaHint +
      shotLine +
      diag;

    await publishBrowserView(session, true);
    return { ok: true, sessionId, output };
    });
  } catch (err) {
    return {
      ok: false,
      error: playwrightInstallHint(err instanceof Error ? err.message : String(err)),
    };
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
    const title = await session.page.title();
    const captcha = await detectCaptchaSignals(session.page);
    const captchaHint = captcha ? formatCaptchaHint(captcha) : "";
    const diag = includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
    await publishBrowserView(session, true);
    return {
      ok: true,
      output: `SESSION_ID: ${sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}\n${snapshotText}${captchaHint}${diag}`,
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
  const resolved = resolveBrowseHref(options.href);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  touchSession(session);
  try {
    return await withBrowserWall(async () => {
      await session.page.goto(resolved.href, {
        waitUntil: options.waitUntil,
        timeout: options.navTimeoutMs,
      });
      const postWait = defaultPostWaitForUrl(session.page.url(), options.postWaitMs);
      if (postWait > 0) {
        await new Promise<void>((r) => setTimeout(r, postWait));
      }
      if (options.screenshot) {
        const shotPath = browserArtifactPath("nav");
        await session.page.screenshot({ path: shotPath, fullPage: true, type: "png", timeout: 45_000 });
        session.lastScreenshotPath = shotPath;
      }
      const { snapshotText, refs } = await buildPageSnapshot(session.page);
      session.refs = refs;
      session.currentUrl = session.page.url();
      const title = await session.page.title();
      const body = (await session.page.innerText("body").catch(() => ""))
        .replace(/\s+/g, " ")
        .slice(0, 4000);
      const diag = options.includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
      const shotLine = session.lastScreenshotPath ? `\nSCREENSHOT_PATH: ${session.lastScreenshotPath}` : "";
      await publishBrowserView(session, true);
      return {
        ok: true,
        output:
          `SESSION_ID: ${options.sessionId}\nURL: ${session.currentUrl}\nTITLE: ${title}\nBODY_EXCERPT:\n${body}\n${snapshotText}${shotLine}${diag}`,
      };
    });
  } catch (err) {
    return { ok: false, error: playwrightInstallHint(err instanceof Error ? err.message : String(err)) };
  }
}

/** User-driven navigation from the native WebView embed (keeps Playwright in sync). */
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
    return page.locator(meta.selector).first();
  }
  return page.getByRole(meta.role as Parameters<Page["getByRole"]>[0], {
    name: meta.name,
    exact: meta.exact ?? true,
  });
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
    case "click_text": {
      const text = shorten(String(o["text"] ?? "").trim(), 400);
      if (!text) return { error: "click_text: text required" };
      return {
        op: {
          op: "click_text",
          text,
          exact: Boolean(o["exact"]),
          timeout_ms: clampTimeout(Number(o["timeout_ms"] ?? 15_000), 45_000),
        },
      };
    }
    case "click_ref": {
      const ref = shorten(String(o["ref"] ?? "").trim(), 16);
      if (!/^e\d+$/.test(ref)) return { error: "click_ref: ref like e1 from SNAPSHOT_REFS" };
      return {
        op: {
          op: "click_ref",
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

export async function runBrowserActions(
  session: BrowserSession,
  ops: BrowserActOp[]
): Promise<{ urlChanged: boolean }> {
  const page = session.page;
  let urlChanged = false;
  const navTimeoutDefault = parseHarnessMs("AGENT_BROWSER_NAV_TIMEOUT_MS", 45_000, 120_000);

  for (let i = 0; i < ops.length; i++) {
    const a = ops[i]!;
    const label = `#${i + 1}:${a.op}`;
    const urlBefore = page.url();
    try {
      switch (a.op) {
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
          await page.locator(a.selector).click({ timeout: a.timeout_ms ?? 15_000 });
          break;
        case "click_role": {
          const loc = a.exact
            ? page.getByRole(a.role as "button", { name: a.name, exact: true })
            : page.getByRole(a.role as "button", {
                name: new RegExp(escapeRegex(a.name), "i"),
              });
          await loc.click({ timeout: a.timeout_ms ?? 15_000 });
          break;
        }
        case "click_text":
          await page.getByText(a.text, { exact: Boolean(a.exact) }).click({
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "click_ref":
          await resolveRefLocator(page, a.ref, session.refs).click({
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "fill":
          await page.locator(a.selector).fill(a.value, { timeout: a.timeout_ms ?? 15_000 });
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
          await page.locator(a.selector).hover({ timeout: a.timeout_ms ?? 15_000 });
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
        case "select_option":
          await page.locator(a.selector).selectOption(a.value, {
            timeout: a.timeout_ms ?? 15_000,
          });
          break;
        case "check":
          await page.locator(a.selector).check({ timeout: a.timeout_ms ?? 15_000 });
          break;
        case "uncheck":
          await page.locator(a.selector).uncheck({ timeout: a.timeout_ms ?? 15_000 });
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
      throw new Error(`browser_act step ${label} failed: ${detail}`);
    }
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
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(options.sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  touchSession(session);
  try {
    return await withBrowserWall(async () => {
    const { urlChanged } = await runBrowserActions(session, options.actions);
    const postWait = defaultPostWaitForUrl(session.page.url(), options.postActionWaitMs);
    if (postWait > 0) {
      await new Promise<void>((r) => setTimeout(r, postWait));
    }
    const text = (await session.page.innerText("body").catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 8000);
    let extra = "";
    const needSnapshot = options.refreshSnapshot || urlChanged;
    if (needSnapshot) {
      const { snapshotText, refs } = await buildPageSnapshot(session.page);
      session.refs = refs;
      extra = `\n${snapshotText}\n`;
    }
    const diag = options.includeConsole ? formatDiagnosticsOutput(session.diagnostics) : "";
    const shotLine = session.lastScreenshotPath
      ? `\nSCREENSHOT_PATH: ${session.lastScreenshotPath}`
      : "";
    await publishBrowserView(session, true);
    return {
      ok: true,
      output:
        `SESSION_ID: ${options.sessionId}\nACTIONS_DONE: success\nURL: ${session.currentUrl}\nBODY_TEXT:\n${text}${extra}${shotLine}${diag}`,
    };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    return await withBrowserWall(async () => {
    const browser = await launchBrowser();
    const context = await buildStealthContext(browser);
    const page = await context.newPage();
    const diagnostics: DiagnosticBuffers = { consoleMsgs: [], pageErrors: [], failedReqs: [] };
    if (options.includeConsole) attachDiagnostics(page, diagnostics);
    await page.goto(options.href, {
      waitUntil: options.waitUntil,
      timeout: options.navTimeoutMs,
    });
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
    const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 8000);
    const diag = options.includeConsole ? formatDiagnosticsOutput(diagnostics) : "";
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    return { ok: true, output: `After act:\n${text}${diag}` };
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

export async function closeAllBrowserSessionsForTask(taskId: string): Promise<number> {
  const ids = listBrowserSessionIdsForTask(taskId);
  for (const id of ids) {
    await closeBrowserSession({ sessionId: id }).catch(() => undefined);
  }
  return ids.length;
}

export async function closeBrowserSession(options: {
  sessionId: string;
  screenshot?: boolean;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(options.sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${options.sessionId}` };
  let shotLine = "";
  try {
    await withBrowserWall(async () => {
    if (options.screenshot) {
      const shotPath = browserArtifactPath("close");
      await session.page.screenshot({ path: shotPath, fullPage: true, type: "png", timeout: 45_000 });
      shotLine = `\nSCREENSHOT_PATH: ${shotPath}`;
    }
    });
  } finally {
    publishBrowserViewClosed(options.sessionId);
    sessions.delete(options.sessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
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
      let rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      if (rel === "/") rel = options.entryFile ? `/${options.entryFile}` : "/index.html";
      const filePath = path.resolve(rootDir, rel.replace(/^\//, ""));
      if (pathEscapesSandbox(rootDir, filePath) || !fs.existsSync(filePath)) {
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
  onTurnEndCleanup?: (taskId: string) => void | Promise<void>;
}): void {
  const prior = harness.onTurnEndCleanup;
  harness.onTurnEndCleanup = (taskId) => {
    void closeAllBrowserSessionsForTask(taskId);
    void closeStaticServersForTask(taskId);
    if (prior) return prior(taskId);
  };
}

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

export type CaptchaType = "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile";

export interface CaptchaSignal {
  type: CaptchaType;
  siteKey: string | null;
  pageUrl: string;
}

export async function detectCaptchaSignals(page: Page): Promise<CaptchaSignal | null> {
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
  includeHidden = false
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    const result = await session.page.evaluate(
      ({ ty, sel, hidden }: { ty: string; sel: string | undefined; hidden: boolean }) => {
        function vis(el: Element): boolean {
          if (hidden) return true;
          const s = window.getComputedStyle(el);
          return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
        }
        if (ty === "tables") {
          const tables = Array.from(document.querySelectorAll("table")).filter(vis);
          return tables.map((t) => {
            const rows = Array.from(t.querySelectorAll("tr")).map((r) =>
              Array.from(r.querySelectorAll("th,td")).map((c) => (c as HTMLElement).innerText.trim().replace(/\s+/g, " "))
            );
            const caption = t.querySelector("caption")?.textContent?.trim() ?? null;
            return { caption, rows };
          });
        }
        if (ty === "links") {
          return Array.from(document.querySelectorAll("a[href]"))
            .filter(vis)
            .map((a) => ({
              text: (a as HTMLAnchorElement).innerText.trim().replace(/\s+/g, " ").slice(0, 200),
              href: (a as HTMLAnchorElement).href,
            }))
            .filter((l) => l.text || l.href);
        }
        if (ty === "text") {
          const root = sel ? document.querySelector(sel) : document.body;
          return (root as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim().slice(0, 50_000) ?? "";
        }
        if (ty === "forms") {
          return Array.from(document.querySelectorAll("form")).map((f) => ({
            action: f.action || null,
            method: f.method || "get",
            fields: Array.from(f.querySelectorAll("input,textarea,select")).filter(vis).map((el) => {
              const inp = el as HTMLInputElement;
              return {
                tag: el.tagName.toLowerCase(),
                type: inp.type || null,
                name: inp.name || null,
                id: inp.id || null,
                placeholder: inp.placeholder || null,
                value: inp.value || null,
                required: inp.required || false,
              };
            }),
          }));
        }
        if (ty === "selector_text") {
          if (!sel) return null;
          const els = Array.from(document.querySelectorAll(sel)).filter(vis);
          return els.map((e) => (e as HTMLElement).innerText.trim().replace(/\s+/g, " ").slice(0, 5000));
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
      },
      { ty: type, sel: selector, hidden: includeHidden }
    );
    return { ok: true, output: JSON.stringify(result, null, 2) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Cookie management ─────────────────────────────────────────────────────────

function cookieProfilePath(profile: string): string {
  const root = resolveWorkspaceRoot();
  const dir = path.join(root, ".agent_artifacts", "browser_cookies");
  fs.mkdirSync(dir, { recursive: true });
  const safe = profile.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  return path.join(dir, `${safe}.json`);
}

export async function getSessionCookies(
  sessionId: string
): Promise<{ ok: true; output: string; cookies: unknown[] } | { ok: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: `Unknown session_id: ${sessionId}` };
  touchSession(session);
  try {
    const cookies = await session.context.cookies();
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
    await session.context.clearCookies();
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
  fs.writeFileSync(p, JSON.stringify(got.cookies, null, 2), "utf8");
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
