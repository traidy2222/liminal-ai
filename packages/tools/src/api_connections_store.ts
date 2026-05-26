/**
 * Persisted registry of external API + MCP connections.
 *
 * Each connection lives as its own JSON record under
 * `~/.liminal/api_connections/<name>.json` so connections survive harness
 * restarts and can be re-attached automatically on boot. The store is
 * intentionally tiny and dependency-free — connections are the bridge between
 * static, hand-written tools and tools that the agent's environment can expand
 * at runtime by pointing at an OpenAPI spec or MCP server.
 *
 * Two record shapes:
 *   - openapi: stores the spec URL + parsed operation list so re-attach is
 *     cheap (no second fetch unless the user asks).
 *   - mcp: stores the server URL + transport so re-attach replays the
 *     `tools/list` JSON-RPC handshake.
 *
 * Auth is stored as a *reference* (env var name or runtime-pref path), never
 * the literal secret. The actual header value is resolved fresh at call time.
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { globalPath } from "@liminal/core";

const CONNECTIONS_DIR_SEG = "api_connections";

/** Absolute path to the connections directory. Created lazily on first write. */
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

/** Conservative sanitizer — connection names become part of tool names. */
export function sanitizeConnectionName(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  return s.replace(/^_+|_+$/g, "").slice(0, 40);
}

export type AuthScheme =
  | { kind: "none" }
  | { kind: "bearer"; envVar: string }
  | { kind: "header"; headerName: string; envVar: string }
  | { kind: "basic"; envVar: string };

export interface OpenApiOperationRecord {
  /** Generated tool name: `api_<conn>_<opSlug>`. */
  toolName: string;
  /** Original operationId (or synthesized method+path). */
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
  /** When true, GET operations skip the approval gate. POST/PUT/DELETE always require approval. */
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
  /** Currently only "http" (Streamable HTTP / JSON-RPC over POST) is supported. */
  transport: "http";
  auth: AuthScheme;
  tools: McpToolRecord[];
  attachedAt: number;
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

/** Resolve an auth scheme to a concrete header to send on each request. */
export function resolveAuthHeader(auth: AuthScheme): Record<string, string> {
  if (auth.kind === "none") return {};
  const value = process.env[auth.envVar]?.trim();
  if (!value) return {};
  if (auth.kind === "bearer") return { Authorization: `Bearer ${value}` };
  if (auth.kind === "basic") return { Authorization: `Basic ${value}` };
  if (auth.kind === "header") return { [auth.headerName]: value };
  return {};
}
