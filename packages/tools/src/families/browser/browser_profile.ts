/** One browser owner per app; its profile is independent of workspaces and releases. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { desktopBrowserEndpoint, requestDesktopBrowserTab } from "./browser_desktop.js";

export function browserProfileRoot(): string {
  const base = process.env.LIMINAL_BROWSER_DATA_DIR || (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Liminal", "Browser")
    : path.join(os.homedir(), ".liminal", "browser"));
  return path.resolve(base);
}

export type BrowserTabRecord = { sessionId: string; ownerTaskId: string; url: string; title: string; paused: boolean;lastUsedAt?:number };
type Workspace = { version: 1; tabs: BrowserTabRecord[]; selectedTabs: Record<string, string>; history: { url: string; title: string; visitedAt: number }[] };
export function readBrowserWorkspace(): Workspace {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(browserProfileRoot(), "workspace.json"), "utf8"));
    if (data.version === 1 && Array.isArray(data.tabs) && Array.isArray(data.history)) return {
      version: 1,
      selectedTabs: data.selectedTabs && typeof data.selectedTabs === "object" && !Array.isArray(data.selectedTabs)
        ? Object.fromEntries(Object.entries(data.selectedTabs).filter(([, id]) => typeof id === "string")) as Record<string, string> : {},
      tabs: data.tabs.filter((t: BrowserTabRecord) => t && typeof t.sessionId === "string" && typeof t.url === "string").slice(0, 24),
      history: data.history.filter((h: Workspace["history"][number]) => h && typeof h.url === "string" && typeof h.title === "string").slice(-500),
    };
  } catch { /* first launch or damaged metadata; Chromium profile remains intact */ }
  return { version: 1, tabs: [], selectedTabs: {}, history: [] };
}
export function saveBrowserWorkspace(tabs: BrowserTabRecord[], visit?: { url: string; title: string }, selectedTabs?: Record<string, string>): void {
  const root = browserProfileRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const previous = readBrowserWorkspace();
  const history = visit && /^https?:/.test(visit.url)
    ? [...previous.history.filter(h => h.url !== visit.url), { ...visit, visitedAt: Date.now() }].slice(-500)
    : previous.history;
  const file = path.join(root, "workspace.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, tabs, history, selectedTabs: selectedTabs ?? previous.selectedTabs }), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

let owned: Promise<BrowserContext> | undefined;
let attached: { endpoint: string; browser: Browser } | undefined;
let attaching: Promise<Browser> | undefined;
let lock: { file: string; nonce: string } | undefined;
export function ownsBrowserProfile(): boolean { return !!lock; }
export function lockBrowserProfile(): void {
  if (lock) return;
  const root = browserProfileRoot(); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, ".owner.json");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const nonce = randomUUID();
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx", mode: 0o600 });
      lock = { file, nonce }; return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let alive = true;
      try { const owner = JSON.parse(fs.readFileSync(file, "utf8")); process.kill(owner.pid, 0); }
      catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
      if (alive) throw new Error("This Liminal browser profile is open in another process. Close that browser owner before reopening it here.");
      fs.unlinkSync(file);
    }
  }
  throw new Error("Could not acquire the Liminal browser profile");
}
function unlockProfile(): void {
  if (!lock) return;
  try { if (JSON.parse(fs.readFileSync(lock.file, "utf8")).nonce === lock.nonce) fs.unlinkSync(lock.file); } catch { /* already released */ }
  lock = undefined;
}
process.once("exit", unlockProfile);
export async function acquireBrowserPage(tabId: string, options: {
  headed: boolean; viewport?: { width: number; height: number }; userAgent?: string;
}): Promise<{ page: Page; context: BrowserContext; browser: Browser; backend: "webview" | "screencast" }> {
  const { chromium } = await import("playwright");
  lockBrowserProfile();
  const endpoint = desktopBrowserEndpoint();
  if (endpoint) {
    try {
      await requestDesktopBrowserTab("open", tabId);
      if (!attached || attached.endpoint !== endpoint || !attached.browser.isConnected()) {
        attaching ??= chromium.connectOverCDP(endpoint, { timeout: 15_000 });
        try { attached = { endpoint, browser: await attaching }; } finally { attaching = undefined; }
      }
      const browser = attached.browser;
      const marker = `about:blank#liminal-tab=${tabId}`;
      // Target discovery may trail native initialization by one CDP event.
      for (let n = 0; n < 100; n++) {
        const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === marker);
        if (page) return { page, context: page.context(), browser, backend: "webview" };
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error("Could not attach to the displayed browser tab");
    } catch (error) {
      await requestDesktopBrowserTab("close", tabId).catch(() => undefined);
      throw error;
    }
  }
  if (!owned) {
    const directory = path.join(browserProfileRoot(), "profiles", "default", "chromium");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    owned = chromium.launchPersistentContext(directory, {
      headless: !options.headed, viewport: options.viewport ?? { width: 1280, height: 800 },
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      acceptDownloads: true, timeout: 60_000,
    });
    const launching = owned;
    owned.catch(() => { if (owned === launching) owned = undefined; });
    void owned.then(context => context.on("close", () => { if (owned === launching) owned = undefined; })).catch(() => undefined);
  }
  const context = await owned;
  const page = await context.newPage();
  if (options.viewport) await page.setViewportSize(options.viewport);
  return { page, context, browser: context.browser()!, backend: "screencast" };
}

export async function releaseBrowserPage(tabId: string, page: Page, backend: "webview" | "screencast"): Promise<void> {
  if (backend === "webview") await requestDesktopBrowserTab("close", tabId);
  else await page.close();
}

export async function shutdownBrowserProfile(): Promise<void> {
  const context = owned; owned = undefined;
  try {
    if (context) await context.then(c => c.close()).catch(() => undefined);
    // Disconnect the CDP client; the desktop owns the native browser's lifetime.
    if (attached) await attached.browser.close().catch(() => undefined);
    attached = undefined;
  } finally { unlockProfile(); }
}
