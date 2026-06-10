import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { Request, Response } from "express";
import { PtyManager } from "@liminal/sidecar/pty";
import { createPtyStreamServer, tryHandlePtyUpgrade } from "@liminal/sidecar/pty-stream";
import type { WebSocketServer } from "ws";
import { readTokenFromUpgrade } from "./pty_auth.js";

export interface WebPtyContext {
  ptyManager: PtyManager;
  ptyWss: WebSocketServer;
  token: string;
  resolveWorkspaceRoot: (chatId: string) => Promise<string>;
}

export function createWebPtyContext(
  token: string,
  resolveWorkspaceRoot: (chatId: string) => Promise<string>
): WebPtyContext {
  const ptyManager = new PtyManager();
  const ptyWss = createPtyStreamServer({ token, ptyManager });
  return { ptyManager, ptyWss, token, resolveWorkspaceRoot };
}

export function attachWebPtyUpgrade(server: Server, ctx: WebPtyContext): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/pty/ws") return;
    const presented = readTokenFromUpgrade(req, url);
    if (!presented || presented !== ctx.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    tryHandlePtyUpgrade(
      req,
      socket,
      head,
      { token: ctx.token, ptyManager: ctx.ptyManager, requireTokenQuery: false },
      ctx.ptyWss,
      "/api/pty/ws"
    );
  });
}

export function registerPtyRoutes(
  router: import("express").Router,
  ctx: WebPtyContext,
  requireAuth: (req: Request, res: Response, next: () => void) => void
): void {
  router.post("/api/pty/open", requireAuth, async (req, res) => {
    try {
      const chatId = String(req.body?.chatId ?? "").trim();
      if (!chatId) {
        res.status(400).json({ error: "chatId required" });
        return;
      }
      const workspaceRoot = await ctx.resolveWorkspaceRoot(chatId);
      const cols = Number(req.body?.cols ?? 80);
      const rows = Number(req.body?.rows ?? 24);
      const label = typeof req.body?.label === "string" ? req.body.label.trim() : undefined;
      const source =
        req.body?.source === "agent" || req.body?.source === "user"
          ? req.body.source
          : undefined;
      const forceNew = req.body?.forceNew === true;
      const cwd = typeof req.body?.cwd === "string" ? req.body.cwd.trim() : undefined;
      const info = ctx.ptyManager.open({
        chatId,
        workspaceRoot,
        cols: Number.isFinite(cols) ? cols : 80,
        rows: Number.isFinite(rows) ? rows : 24,
        label: label || undefined,
        source,
        forceNew,
        cwd: cwd || undefined,
      });
      res.json({
        sessionId: info.sessionId,
        chatId: info.chatId,
        workspaceRoot: info.workspaceRoot,
        cwd: info.cwd,
        cols: info.cols,
        rows: info.rows,
        label: info.label,
        source: info.source,
        streamPath: `/api/pty/ws?sessionId=${encodeURIComponent(info.sessionId)}`,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/api/pty/resize", requireAuth, (req, res) => {
    const sessionId = String(req.body?.sessionId ?? "").trim();
    const cols = Number(req.body?.cols);
    const rows = Number(req.body?.rows);
    if (!sessionId || !Number.isFinite(cols) || !Number.isFinite(rows)) {
      res.status(400).json({ error: "sessionId, cols, rows required" });
      return;
    }
    const ok = ctx.ptyManager.resize(sessionId, cols, rows);
    res.status(ok ? 200 : 404).json({ ok });
  });

  router.post("/api/pty/close", requireAuth, (req, res) => {
    const sessionId = String(req.body?.sessionId ?? "").trim();
    const chatId = String(req.body?.chatId ?? "").trim();
    let ok = false;
    if (sessionId) ok = ctx.ptyManager.close(sessionId);
    else if (chatId) {
      ctx.ptyManager.closeForChat(chatId);
      ok = true;
    } else {
      res.status(400).json({ error: "sessionId or chatId required" });
      return;
    }
    res.json({ ok });
  });

  router.get("/api/pty/list", requireAuth, (req, res) => {
    const chatId = typeof req.query.chatId === "string" ? req.query.chatId.trim() : undefined;
    res.json({ sessions: ctx.ptyManager.list(chatId) });
  });
}
