import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { Request, Response } from "express";
import {
  createBrowserStreamServer,
  tryHandleBrowserStreamUpgrade,
} from "@liminal/sidecar/browser-stream";
import {
  tryHandleBrowserCookiesRequest,
  tryHandleBrowserNavigateRequest,
} from "@liminal/sidecar/browser-sync";
import { getBrowserPanelFrame } from "@liminal/tools";
import { readTokenFromUpgrade } from "./pty_auth.js";

export interface WebBrowserContext {
  browserWss: ReturnType<typeof createBrowserStreamServer>;
  token: string;
}

export function createWebBrowserContext(token: string): WebBrowserContext {
  return { browserWss: createBrowserStreamServer(), token };
}

export function attachBrowserStreamUpgrade(server: Server, ctx: WebBrowserContext): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/browser/ws") return;
    const presented = readTokenFromUpgrade(req, url);
    if (!presented || presented !== ctx.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    tryHandleBrowserStreamUpgrade(
      req,
      socket,
      head,
      { token: ctx.token, requireTokenQuery: false },
      ctx.browserWss,
      "/api/browser/ws"
    );
  });
}

export function registerBrowserRoutes(
  router: import("express").Router,
  ctx: WebBrowserContext,
  requireAuth: (req: Request, res: Response, next: () => void) => void
): void {
  router.get("/api/browser/preview", requireAuth, (req, res) => {
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).send("sessionId required");
      return;
    }
    const frame = getBrowserPanelFrame(sessionId);
    if (!frame || frame.length === 0) {
      res.status(404).send("Preview not ready");
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(frame);
  });
}
