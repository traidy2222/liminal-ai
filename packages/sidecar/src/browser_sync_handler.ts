import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSessionCookies,
  userNavigateBrowserSession,
} from "@liminal/tools";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
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

/** Export Playwright session cookies so the desktop WebView can mirror auth state. */
export function tryHandleBrowserCookiesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string }
): boolean {
  if (req.method !== "GET") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/browser/cookies") return false;

  const presented = url.searchParams.get("token")?.trim() ?? "";
  if (presented !== opts.token) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return true;
  }

  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("sessionId required");
    return true;
  }

  void (async () => {
    const got = await getSessionCookies(sessionId);
    if (!got.ok) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: got.error }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, cookies: got.cookies }));
  })();
  return true;
}

/** Mirror in-app WebView navigations into the agent Playwright session. */
export function tryHandleBrowserNavigateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string }
): boolean {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/browser/navigate") return false;

  const presented = url.searchParams.get("token")?.trim() ?? "";
  if (presented !== opts.token) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return true;
  }

  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("sessionId required");
    return true;
  }

  void (async () => {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const target = String(body["url"] ?? "").trim();
      if (!target) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "url required" }));
        return;
      }
      const result = await userNavigateBrowserSession({ sessionId, href: target });
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid json" }));
    }
  })();
  return true;
}
