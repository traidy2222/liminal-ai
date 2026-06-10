import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { PtyManager } from "./pty_manager.js";

export interface PtyStreamHandlerOptions {
  token: string;
  ptyManager: PtyManager;
  /** When false, caller already authenticated the upgrade (web `authToken`). */
  requireTokenQuery?: boolean;
}

/**
 * Raw terminal I/O WebSocket (string frames) — ghostty-web / xterm compatible.
 */
export function createPtyStreamServer(_opts: PtyStreamHandlerOptions): WebSocketServer {
  return new WebSocketServer({ noServer: true });
}

export function tryHandlePtyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: PtyStreamHandlerOptions,
  ptyWss: WebSocketServer,
  pathname: string = "/pty"
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

  if (!opts.ptyManager.get(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return true;
  }

  ptyWss.handleUpgrade(req, socket, head, (ws) => {
    const ok = opts.ptyManager.attachSocket(sessionId, ws);
    if (!ok) {
      ws.close(4404, "unknown_session");
      return;
    }
    ws.on("error", () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  });
  return true;
}
