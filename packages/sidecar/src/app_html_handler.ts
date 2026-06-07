import type { IncomingMessage, ServerResponse } from "node:http";
import { getApp, readAppHtml, repairWidgetHtmlDocument } from "@liminal/core";

/**
 * Serve persisted widget HTML for desktop sub-windows.
 * GET /app_html?token=&appId=
 */
export function tryHandleAppHtmlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string }
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/app_html") return false;

  const presented = url.searchParams.get("token") ?? "";
  if (presented !== opts.token) {
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  const appId = url.searchParams.get("appId")?.trim() ?? "";
  if (!appId) {
    res.writeHead(400);
    res.end("appId required");
    return true;
  }

  void (async () => {
    const spec = await getApp(appId);
    if (!spec) {
      res.writeHead(404);
      res.end("Unknown app");
      return;
    }
    const raw = await readAppHtml(appId);
    if (!raw) {
      res.writeHead(404);
      res.end("HTML not ready");
      return;
    }
    const html = repairWidgetHtmlDocument(raw);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": String(Buffer.byteLength(html, "utf8")),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(html);
  })();

  return true;
}
