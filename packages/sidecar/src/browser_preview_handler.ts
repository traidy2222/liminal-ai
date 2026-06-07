import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Token-gated JPEG preview for the embedded browser dock (Playwright viewport).
 */
export function tryHandleBrowserPreviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    token: string;
    resolveFrame: (sessionId: string) => Buffer | undefined;
  }
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/browser_preview") return false;

  const presented = url.searchParams.get("token") ?? "";
  if (presented !== opts.token) {
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    res.writeHead(400);
    res.end("sessionId required");
    return true;
  }

  const frame = opts.resolveFrame(sessionId);
  if (!frame || frame.length === 0) {
    res.writeHead(404);
    res.end("Preview not ready");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "no-store",
    "Content-Length": String(frame.length),
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(frame);
  return true;
}
