import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { NextFunction, Request, Response } from "express";
import { globalPath, ensureGlobalStorageRoot } from "@liminal/core";

const TOKEN_FILE = "web_token";

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const n = ip.replace(/^::ffff:/, "").toLowerCase();
  return n === "127.0.0.1" || n === "::1" || n === "localhost";
}

/** True when the request targets this machine's local harness UI (loopback IP or localhost Host). */
export function isLocalHarnessRequest(req: Request): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) return true;
  const host = (req.headers.host ?? "").split(":")[0]?.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function readTokenFromRequest(req: Request): string | null {
  const header =
    req.header("authorization")?.startsWith("Bearer ")
      ? req.header("authorization")!.slice("Bearer ".length).trim()
      : req.header("x-liminal-token")?.trim();
  if (header) return header;
  const q = req.query["authToken"];
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export interface LocalWebAuth {
  readonly token: string;
  isExempt(req: Request): boolean;
  requireAuth(req: Request, res: Response, next: NextFunction): void;
}

async function loadOrCreateToken(): Promise<string> {
  const env = process.env["AGENT_WEB_TOKEN"]?.trim();
  if (env) return env;

  await ensureGlobalStorageRoot();
  const path = globalPath(TOKEN_FILE);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* generate below */
  }

  const token = randomBytes(32).toString("hex");
  await writeFile(path, token, { mode: 0o600, encoding: "utf8" });
  try {
    await chmod(path, 0o600);
  } catch {
    /* ignore on Windows */
  }
  return token;
}

export async function createLocalWebAuth(): Promise<LocalWebAuth> {
  const token = await loadOrCreateToken();

  const isExempt = (req: Request): boolean => {
    const path = req.path;
    if (
      (req.method === "POST" || req.method === "GET") &&
      path === "/api/vireon/auth/callback"
    ) {
      return true;
    }
    if (
      path === "/api/integrations/oauth/handoff" &&
      isLoopbackAddress(req.socket.remoteAddress) &&
      (req.method === "POST" || req.method === "OPTIONS")
    ) {
      return true;
    }
    if (req.method === "GET" && path === "/oauth/google/callback") {
      return isLoopbackAddress(req.socket.remoteAddress);
    }
    if (req.method === "GET" && path === "/api/config") {
      return isLocalHarnessRequest(req);
    }
    return false;
  };

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (isExempt(req)) {
      next();
      return;
    }
    const provided = readTokenFromRequest(req);
    if (provided && provided === token) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized — missing or invalid web auth token" });
  };

  return { token, isExempt, requireAuth };
}

export function resolveWebBindHost(): string {
  const raw = process.env["AGENT_WEB_BIND_HOST"]?.trim();
  if (raw) return raw;
  return "127.0.0.1";
}

export function allowedWebCorsOrigins(port: number): string[] {
  const extra = process.env["AGENT_WEB_CORS_ORIGINS"]?.trim();
  const base = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:3000`,
    `http://localhost:3000`,
    `http://127.0.0.1:5173`,
    `http://localhost:5173`,
    "https://www.vireondynamics.com",
    "https://vireondynamics.com",
  ];
  if (extra) {
    for (const o of extra.split(",")) {
      const t = o.trim();
      if (t) base.push(t);
    }
  }
  return [...new Set(base)];
}
