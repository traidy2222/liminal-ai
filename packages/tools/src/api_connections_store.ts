/**
 * Persisted registry of external API + MCP connections.
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { globalPath, getGoogleAccessToken, getMicrosoftAccessToken } from "@liminal/core";

const CONNECTIONS_DIR_SEG = "api_connections";

export function connectionsDir(): string {
  return globalPath(CONNECTIONS_DIR_SEG);
}

function ensureDirSync(): string {
  const dir = connectionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function ensureDir(): Promise<string> {
  const dir = connectionsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function sanitizeConnectionName(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  return s.replace(/^_+|_+$/g, "").slice(0, 40);
}

export type AuthScheme =
  | { kind: "none" }
  | { kind: "bearer"; envVar: string }
  | { kind: "header"; headerName: string; envVar: string }
  | { kind: "basic"; envVar: string }
  | { kind: "oauth2"; provider: "google"; accountId?: string; scopes: string[] }
  | { kind: "oauth2"; provider: "microsoft"; accountId?: string; scopes: string[] };

export interface McpToolFilter {
  include?: string[];
  exclude?: string[];
}

export interface OpenApiOperationRecord {
  toolName: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  summary?: string;
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header";
    required: boolean;
    schema: { type?: string; enum?: unknown[]; description?: string };
  }>;
  requestBody?: {
    required: boolean;
    contentType: string;
    schema: Record<string, unknown> | null;
  };
}

export interface OpenApiConnectionRecord {
  kind: "openapi";
  name: string;
  specUrl: string;
  baseUrl: string;
  auth: AuthScheme;
  autoApproveReads: boolean;
  operations: OpenApiOperationRecord[];
  attachedAt: number;
}

export interface McpToolRecord {
  toolName: string;
  remoteName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnectionRecord {
  kind: "mcp";
  name: string;
  serverUrl: string;
  transport: "http";
  auth: AuthScheme;
  tools: McpToolRecord[];
  attachedAt: number;
  providerId?: string;
  parentProvider?: string;
  services?: string[];
  readOnly?: boolean;
  autoActivate?: boolean;
  toolFilter?: McpToolFilter;
  oauthAccountId?: string;
  sidecarManaged?: boolean;
}

export type ConnectionRecord = OpenApiConnectionRecord | McpConnectionRecord;

function recordPath(name: string): string {
  return path.join(connectionsDir(), `${sanitizeConnectionName(name)}.json`);
}

export async function readConnection(name: string): Promise<ConnectionRecord | null> {
  try {
    const raw = await readFile(recordPath(name), "utf8");
    const parsed = JSON.parse(raw) as ConnectionRecord;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.kind !== "openapi" && parsed.kind !== "mcp") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeConnection(record: ConnectionRecord): Promise<void> {
  await ensureDir();
  await writeFile(recordPath(record.name), JSON.stringify(record, null, 2), "utf8");
}

export async function deleteConnection(name: string): Promise<boolean> {
  try {
    await unlink(recordPath(name));
    return true;
  } catch {
    return false;
  }
}

export async function listConnections(): Promise<ConnectionRecord[]> {
  ensureDirSync();
  let entries: string[] = [];
  try {
    entries = await readdir(connectionsDir());
  } catch {
    return [];
  }
  const out: ConnectionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rec = await readConnection(entry.replace(/\.json$/, ""));
    if (rec) out.push(rec);
  }
  out.sort((a, b) => b.attachedAt - a.attachedAt);
  return out;
}

/** Sync auth resolution (env-var schemes only). */
export function resolveAuthHeader(auth: AuthScheme): Record<string, string> {
  if (auth.kind === "none") return {};
  if (auth.kind === "oauth2") return {};
  const value = process.env[auth.envVar]?.trim();
  if (!value) return {};
  if (auth.kind === "bearer") return { Authorization: `Bearer ${value}` };
  if (auth.kind === "basic") return { Authorization: `Basic ${value}` };
  if (auth.kind === "header") return { [auth.headerName]: value };
  return {};
}

/** Async auth — resolves OAuth2 access tokens with refresh. */
export async function resolveAuthHeaderAsync(auth: AuthScheme): Promise<Record<string, string>> {
  if (auth.kind === "oauth2" && auth.provider === "google") {
    const token = await getGoogleAccessToken(auth.accountId);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.kind === "oauth2" && auth.provider === "microsoft") {
    const token = await getMicrosoftAccessToken(auth.accountId);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }
  return resolveAuthHeader(auth);
}

export function googleOAuthAuthScheme(accountId?: string, scopes: string[] = []): AuthScheme {
  return { kind: "oauth2", provider: "google", accountId, scopes };
}

export function microsoftOAuthAuthScheme(accountId?: string, scopes: string[] = []): AuthScheme {
  return { kind: "oauth2", provider: "microsoft", accountId, scopes };
}

export function listConnectionsByParent(parentProvider: string): Promise<McpConnectionRecord[]> {
  return listConnections().then((all) =>
    all.filter(
      (c): c is McpConnectionRecord =>
        c.kind === "mcp" && c.parentProvider === parentProvider
    )
  );
}
