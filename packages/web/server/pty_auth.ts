import type { IncomingMessage } from "node:http";

/** Read web auth token from WS upgrade (query `authToken` or `Authorization` header). */
export function readTokenFromUpgrade(req: IncomingMessage, url: URL): string | null {
  const query = url.searchParams.get("authToken")?.trim();
  if (query) return query;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const lim = req.headers["x-liminal-token"];
  if (typeof lim === "string" && lim.trim()) return lim.trim();
  return null;
}
