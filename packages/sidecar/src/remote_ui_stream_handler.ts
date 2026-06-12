import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

const OPEN = 1;

export type RemoteUiInput =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { type: "keydown"; key: string }
  | { type: "type"; text: string };

export type RemoteUiMeta = {
  width: number;
  height: number;
  windowId?: string;
  title?: string;
};

type UiStreamState = {
  joinToken: string;
  role: "view" | "control";
  subscribers: Set<WebSocket>;
  latestFrame: Buffer | null;
  latestMeta: RemoteUiMeta | null;
};

const streamsByToken = new Map<string, UiStreamState>();

export function createRemoteUiStreamServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true });
}

export function parseRemoteUiInput(raw: unknown): RemoteUiInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = o["type"];
  if (type === "click") {
    const x = Number(o["x"]);
    const y = Number(o["y"]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const button = o["button"];
    const b = button === "right" || button === "middle" ? button : ("left" as const);
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

function getOrCreateStream(joinToken: string, role: "view" | "control"): UiStreamState {
  let state = streamsByToken.get(joinToken);
  if (!state) {
    state = { joinToken, role, subscribers: new Set(), latestFrame: null, latestMeta: null };
    streamsByToken.set(joinToken, state);
  }
  return state;
}

export function publishRemoteUiFrame(joinToken: string, frame: Buffer, meta: RemoteUiMeta): void {
  const state = streamsByToken.get(joinToken.trim());
  if (!state) return;
  state.latestFrame = frame;
  state.latestMeta = meta;
  const metaJson = JSON.stringify({ type: "meta", ...meta });
  for (const ws of state.subscribers) {
    if (ws.readyState !== OPEN) continue;
    try {
      if (state.latestMeta) ws.send(metaJson);
      ws.send(frame, { binary: true });
    } catch {
      /* ignore */
    }
  }
}

export function clearRemoteUiStream(joinToken: string): void {
  streamsByToken.delete(joinToken.trim());
}

export function hasAnyRemoteUiSubscriber(): boolean {
  for (const state of streamsByToken.values()) {
    if (state.subscribers.size > 0) return true;
  }
  return false;
}

export type RemoteUiInputHandler = (input: RemoteUiInput) => void;

export function tryHandleRemoteUiStreamUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: {
    joinToken: string;
    role: "view" | "control";
    onInput?: RemoteUiInputHandler;
  },
  uiWss: WebSocketServer,
  pathname = "/remote/ui/stream"
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== pathname) return false;

  const join = url.searchParams.get("join")?.trim();
  if (!join || join !== opts.joinToken) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return true;
  }

  uiWss.handleUpgrade(req, socket, head, (ws) => {
    const state = getOrCreateStream(join, opts.role);
    state.subscribers.add(ws);
    if (state.latestMeta) {
      ws.send(JSON.stringify({ type: "meta", ...state.latestMeta }));
    }
    if (state.latestFrame) {
      ws.send(state.latestFrame, { binary: true });
    }
    ws.on("message", (data) => {
      if (opts.role !== "control" || !opts.onInput) return;
      try {
        const raw = JSON.parse(String(data));
        const input = parseRemoteUiInput(raw);
        if (input) opts.onInput(input);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => state.subscribers.delete(ws));
    ws.on("error", () => state.subscribers.delete(ws));
  });
  return true;
}
