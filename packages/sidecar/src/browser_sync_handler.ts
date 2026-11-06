import type { IncomingMessage, ServerResponse } from "node:http";
import { controlBrowserWorkspace, registerDesktopBrowser, pollDesktopBrowser, completeDesktopBrowserCommand } from "@liminal/tools";

/** Browser commands use a bearer header: no browser state or profile secrets in URLs. */
export function tryHandleBrowserWorkspaceRequest(req: IncomingMessage, res: ServerResponse,
  opts: { token: string }): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/browser/control" && url.pathname !== "/browser/desktop") return false;
  if (req.headers.authorization !== `Bearer ${opts.token}` || req.headers.origin) {
    res.writeHead(401); res.end("Unauthorized"); return true;
  }
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  void (async () => {
    try {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      const body = await readJsonBody(req) as Record<string, unknown>;
      if (url.pathname === "/browser/control") {
        const result = await controlBrowserWorkspace(String(body.action ?? "state"),
          typeof body.sessionId === "string" ? body.sessionId : undefined,
          typeof body.url === "string" ? body.url : undefined,
          typeof body.chatId === "string" && body.chatId.trim() ? body.chatId.trim() : undefined);
        res.end(JSON.stringify(result)); return;
      }
      const clientId = String(body.clientId ?? "");
      if (body.action === "register") registerDesktopBrowser(clientId, Number(body.port));
      else if (body.action === "poll") {
        const command = await pollDesktopBrowser(clientId);
        res.end(JSON.stringify({ ok: true, command })); return;
      } else if (body.action === "complete") completeDesktopBrowserCommand(clientId, String(body.id ?? ""),
        typeof body.error === "string" ? body.error : undefined);
      else throw new Error("Unknown desktop browser action");
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      if (!res.headersSent) res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  })();
  return true;
}
import {
  getSessionCookies,
  userNavigateBrowserSession,
} from "@liminal/tools";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > 64 * 1024) { reject(new Error("Browser request too large")); req.destroy(); }
      else chunks.push(c as Buffer);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
