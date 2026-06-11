import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import {
  getBrowserSession,
  subscribeBrowserScreencast,
  unsubscribeBrowserScreencast,
  handleBrowserStreamInput,
  startBrowserScreencast,
} from "@liminal/tools";

export interface BrowserStreamHandlerOptions {
  token: string;
  /** When false, caller already authenticated the upgrade (web `authToken`). */
  requireTokenQuery?: boolean;
}

export function createBrowserStreamServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true });
}

export function tryHandleBrowserStreamUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: BrowserStreamHandlerOptions,
  browserWss: WebSocketServer,
  pathname: string = "/browser/stream"
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== pathname) return false;

  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return true;
  }
  if (opts.requireTokenQuery !== false) {
    const token = url.searchParams.get("token")?.trim();
    if (!token || token !== opts.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return true;
    }
  }

  if (!getBrowserSession(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return true;
  }

  browserWss.handleUpgrade(req, socket, head, (ws) => {
    void startBrowserScreencast(sessionId).then(() => {
      subscribeBrowserScreencast(sessionId, ws);
      ws.on("message", (data) => {
        try {
          const raw = JSON.parse(String(data));
          void handleBrowserStreamInput(sessionId, raw);
        } catch {
          /* ignore malformed input */
        }
      });
      ws.on("close", () => unsubscribeBrowserScreencast(sessionId, ws));
      ws.on("error", () => unsubscribeBrowserScreencast(sessionId, ws));
    });
  });
  return true;
}
