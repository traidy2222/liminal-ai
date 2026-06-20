/**
 * Tracks the active IDA database/session and injects it into MCP tool calls.
 * ida-pro-mcp requires `database` (and some builds also accept `session_id`) on
 * every IDB-dependent tool unless the MCP transport context is explicitly bound.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";

const IDA_SKIP_INJECT = new Set([
  "idb_list",
  "idalib_list",
  "idb_open",
  "idalib_open",
  "idalib_switch",
  "idb_switch",
  "idalib_current",
  "idalib_unbind",
  "server_health",
]);

let activeDatabase: string | null = null;

export function getIdaActiveDatabase(): string | null {
  return activeDatabase;
}

export function setIdaActiveDatabase(database: string | null): void {
  const trimmed = database?.trim();
  activeDatabase = trimmed ? trimmed : null;
}

export function resetIdaActiveDatabase(): void {
  activeDatabase = null;
}

function pickSessionFields(session: Record<string, unknown>): string | null {
  const sessionId = typeof session.session_id === "string" ? session.session_id.trim() : "";
  const inputPath = typeof session.input_path === "string" ? session.input_path.trim() : "";
  const filename = typeof session.filename === "string" ? session.filename.trim() : "";
  return sessionId || inputPath || filename || null;
}

function sessionsFromListPayload(data: Record<string, unknown>): Record<string, unknown>[] {
  const raw = data.sessions;
  if (Array.isArray(raw)) {
    return raw.filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  }
  return [];
}

export function absorbIdaSessionFromPayload(
  remoteName: string,
  args: Record<string, unknown>,
  payload: Record<string, unknown>
): void {
  const listNames = new Set(["idb_list", "idalib_list"]);
  const openNames = new Set(["idb_open", "idalib_open"]);
  const switchNames = new Set(["idalib_switch", "idb_switch"]);

  if (listNames.has(remoteName)) {
    const sessions = sessionsFromListPayload(payload);
    if (sessions.length === 0) return;
    const preferred =
      sessions.find((s) => s.is_current_context === true) ??
      sessions.find((s) => s.is_active === true) ??
      (sessions.length === 1 ? sessions[0] : undefined);
    if (!preferred) return;
    const picked = pickSessionFields(preferred);
    if (picked) setIdaActiveDatabase(picked);
    return;
  }

  if (openNames.has(remoteName)) {
    const session =
      payload.session && typeof payload.session === "object"
        ? (payload.session as Record<string, unknown>)
        : payload;
    const picked = pickSessionFields(session);
    if (picked) setIdaActiveDatabase(picked);
    return;
  }

  if (switchNames.has(remoteName)) {
    const sid =
      (typeof args.session_id === "string" && args.session_id.trim()) ||
      (typeof args.database === "string" && args.database.trim()) ||
      pickSessionFields(payload);
    if (sid) setIdaActiveDatabase(sid);
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function absorbIdaToolOutput(
  remoteName: string,
  args: Record<string, unknown>,
  output: string
): void {
  const payload = tryParseJsonObject(output);
  if (!payload) return;
  if (payload.error) return;
  absorbIdaSessionFromPayload(remoteName, args, payload);
}

export function injectIdaDatabaseArgs(
  remoteName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (IDA_SKIP_INJECT.has(remoteName)) return args;

  const database =
    (typeof args.database === "string" && args.database.trim()) ||
    (typeof args.session_id === "string" && args.session_id.trim()) ||
    "";
  if (database) return args;

  const active = activeDatabase?.trim();
  if (!active) return args;

  const next = { ...args };
  if (!next.database) next.database = active;
  if (!next.session_id) next.session_id = active;
  return next;
}

export function wrapIdaMcpHandler(
  remoteName: string,
  inner: ToolDefinition["handler"]
): ToolDefinition["handler"] {
  return async (args): Promise<ToolResult> => {
    const injected = injectIdaDatabaseArgs(remoteName, args as Record<string, unknown>);
    const result = await inner(injected);
    if (result.ok && result.output) {
      absorbIdaToolOutput(remoteName, injected, result.output);
    }
    return result;
  };
}
