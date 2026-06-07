import type { IncomingMessage, ServerResponse } from "node:http";
import { getApp } from "@liminal/core";
import { isProxyUrlAllowed, normalizeProxyHosts } from "@liminal/core";

/**
 * Token-gated HTTP proxy for sandboxed widget windows.
 * GET /app_proxy?token=&appId=&url=
 */
export function tryHandleAppProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    token: string;
    fetchFn?: typeof fetch;
  }
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/app_proxy") return false;

  const presented = url.searchParams.get("token") ?? "";
  if (presented !== opts.token) {
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  const appId = url.searchParams.get("appId")?.trim() ?? "";
  const target = url.searchParams.get("url")?.trim() ?? "";
  if (!appId || !target) {
    res.writeHead(400);
    res.end("appId and url required");
    return true;
  }

  void (async () => {
    try {
      const spec = await getApp(appId);
      if (!spec) {
        res.writeHead(404);
        res.end("Unknown app");
        return;
      }
      const props = spec.props;
      const dataFetch = props["data_fetch"];
      const fromFetch =
        dataFetch && typeof dataFetch === "object"
          ? normalizeProxyHosts(
              (props["proxy_hosts"] as string[] | undefined) ??
                [new URL(String((dataFetch as Record<string, unknown>)["url"] ?? "")).hostname]
            )
          : normalizeProxyHosts(props["proxy_hosts"]);
      const allowHosts = fromFetch.filter(Boolean);
      if (!isProxyUrlAllowed(target, allowHosts)) {
        res.writeHead(403);
        res.end("URL not allowlisted for this app");
        return;
      }
      const fetchFn = opts.fetchFn ?? fetch;
      const upstream = await fetchFn(target, {
        method: "GET",
        headers: { Accept: "application/json, text/plain, */*" },
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const ctype = upstream.headers.get("content-type") ?? "application/octet-stream";
      res.writeHead(upstream.status, {
        "Content-Type": ctype,
        "Cache-Control": "no-store",
        "Content-Length": String(body.length),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    } catch (err) {
      res.writeHead(502);
      res.end(err instanceof Error ? err.message : String(err));
    }
  })();

  return true;
}
