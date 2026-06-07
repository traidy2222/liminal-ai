import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

/**
 * Token-gated read-only media for workspace-relative paths (markdown image src).
 */
export function tryHandleMediaRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    token: string;
    resolveWorkspaceRoot: (chatId: string | null) => string | null;
  }
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/media") return false;

  const presented = url.searchParams.get("token") ?? "";
  if (presented !== opts.token) {
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  const relPath = (url.searchParams.get("path") ?? "").replace(/\\/g, "/");
  if (!relPath || relPath.includes("..")) {
    res.writeHead(400);
    res.end("Invalid path");
    return true;
  }

  const chatId = url.searchParams.get("chatId");
  const workspaceRoot = opts.resolveWorkspaceRoot(chatId);
  if (!workspaceRoot) {
    res.writeHead(404);
    res.end("Workspace not found");
    return true;
  }

  const root = resolve(workspaceRoot);
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = extname(abs).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)) {
    res.writeHead(415);
    res.end("Unsupported media type");
    return true;
  }

  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": String(mime), "Cache-Control": "private, max-age=60" });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(abs).pipe(res);
  return true;
}
