/**
 * CDP Page.startScreencast + WebSocket fan-out + viewport input relay for embedded browser UI.
 */
import type { CDPSession, Page } from "playwright";
import {
  applyScreencastFrame,
  getBrowserSession,
  refreshBrowserEmbedView,
  syncBrowserSessionUrl,
} from "./browser_runtime.js";

const OPEN = 1;

export interface BrowserStreamSocket {
  readyState: number;
  send(data: string | Buffer, options?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  on(event: "close" | "error", listener: () => void): void;
}

export type BrowserStreamInput =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { type: "keydown"; key: string }
  | { type: "type"; text: string };

type ScreencastState = {
  sessionId: string;
  page: Page;
  viewportWidth: number;
  viewportHeight: number;
  cdp: CDPSession;
  subscribers: Set<BrowserStreamSocket>;
  refreshTimer?: ReturnType<typeof setTimeout>;
};

const screencasts = new Map<string, ScreencastState>();

function parseViewport(page: Page): { width: number; height: number } {
  const vp = page.viewportSize();
  return { width: vp?.width ?? 1280, height: vp?.height ?? 800 };
}

function broadcastBinary(sessionId: string, frame: Buffer): void {
  const state = screencasts.get(sessionId);
  if (!state) return;
  for (const ws of state.subscribers) {
    if (ws.readyState !== OPEN) continue;
    try {
      ws.send(frame, { binary: true });
    } catch {
      /* ignore */
    }
  }
}

function broadcastMeta(sessionId: string): void {
  const state = screencasts.get(sessionId);
  const session = getBrowserSession(sessionId);
  if (!state || !session) return;
  const payload = JSON.stringify({
    type: "meta",
    sessionId,
    viewportWidth: state.viewportWidth,
    viewportHeight: state.viewportHeight,
    url: session.currentUrl,
    title: "",
  });
  for (const ws of state.subscribers) {
    if (ws.readyState !== OPEN) continue;
    try {
      ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

export function getBrowserScreencastMeta(sessionId: string): {
  sessionId: string;
  viewportWidth: number;
  viewportHeight: number;
  url: string;
} | null {
  const state = screencasts.get(sessionId);
  const session = getBrowserSession(sessionId);
  if (!session) return null;
  const vp = state ?? { viewportWidth: parseViewport(session.page).width, viewportHeight: parseViewport(session.page).height };
  return {
    sessionId,
    viewportWidth: vp.viewportWidth,
    viewportHeight: vp.viewportHeight,
    url: session.currentUrl,
  };
}

export async function startBrowserScreencast(sessionId: string): Promise<void> {
  if (screencasts.has(sessionId)) return;
  const session = getBrowserSession(sessionId);
  if (!session) return;

  const page = session.page;
  const { width, height } = parseViewport(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 72,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  });

  const state: ScreencastState = {
    sessionId,
    page,
    viewportWidth: width,
    viewportHeight: height,
    cdp,
    subscribers: new Set(),
  };
  screencasts.set(sessionId, state);

  cdp.on("Page.screencastFrame", async (params: { data: string; sessionId: number }) => {
    try {
      const buf = Buffer.from(params.data, "base64");
      if (buf.length > 64) {
        applyScreencastFrame(sessionId, buf);
        broadcastBinary(sessionId, buf);
      }
      await cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
    } catch {
      /* ignore frame errors */
    }
  });
}

export async function stopBrowserScreencastForSession(sessionId: string): Promise<void> {
  const state = screencasts.get(sessionId);
  if (!state) return;
  screencasts.delete(sessionId);
  for (const ws of state.subscribers) {
    try {
      ws.close(1000, "session_closed");
    } catch {
      /* ignore */
    }
  }
  state.subscribers.clear();
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  try {
    await state.cdp.send("Page.stopScreencast");
  } catch {
    /* ignore */
  }
  try {
    await state.cdp.detach();
  } catch {
    /* ignore */
  }
}

export function subscribeBrowserScreencast(sessionId: string, ws: BrowserStreamSocket): void {
  const state = screencasts.get(sessionId);
  if (!state) return;
  state.subscribers.add(ws);
  const meta = getBrowserScreencastMeta(sessionId);
  if (meta && ws.readyState === OPEN) {
    ws.send(JSON.stringify({ type: "meta", ...meta }));
  }
}

export function unsubscribeBrowserScreencast(sessionId: string, ws: BrowserStreamSocket): void {
  screencasts.get(sessionId)?.subscribers.delete(ws);
}

export function parseBrowserStreamInput(raw: unknown): BrowserStreamInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = o["type"];
  if (type === "click") {
    const x = Number(o["x"]);
    const y = Number(o["y"]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const button = o["button"];
    const b =
      button === "right" || button === "middle" ? button : ("left" as const);
    return { type: "click", x, y, button: b };
  }
  if (type === "wheel") {
    const x = Number(o["x"]);
    const y = Number(o["y"]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      type: "wheel",
      x,
      y,
      deltaX: Number(o["deltaX"] ?? 0) || 0,
      deltaY: Number(o["deltaY"] ?? 0) || 0,
    };
  }
  if (type === "keydown") {
    const key = String(o["key"] ?? "").trim();
    if (!key) return null;
    return { type: "keydown", key };
  }
  if (type === "type") {
    const text = String(o["text"] ?? "");
    if (!text) return null;
    return { type: "type", text };
  }
  return null;
}

function scheduleEmbedRefresh(sessionId: string): void {
  const state = screencasts.get(sessionId);
  if (!state) return;
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = undefined;
    void refreshBrowserEmbedView(sessionId);
    broadcastMeta(sessionId);
  }, 280);
}

export async function handleBrowserStreamInput(
  sessionId: string,
  raw: unknown
): Promise<void> {
  const session = getBrowserSession(sessionId);
  if (!session) return;
  const input = parseBrowserStreamInput(raw);
  if (!input) return;

  const page = session.page;
  try {
    switch (input.type) {
      case "click":
        await page.mouse.click(input.x, input.y, { button: input.button ?? "left" });
        break;
      case "wheel":
        await page.mouse.move(input.x, input.y);
        await page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0);
        break;
      case "keydown":
        await page.keyboard.press(input.key);
        break;
      case "type":
        await page.keyboard.type(input.text);
        break;
    }
    syncBrowserSessionUrl(sessionId);
    scheduleEmbedRefresh(sessionId);
  } catch {
    /* user input is best-effort */
  }
}
