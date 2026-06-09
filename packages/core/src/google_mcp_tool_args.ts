/** Model-friendly arg normalization for mcp_google_* tools (before JSON-schema validation). */

import type { ToolParameterSchema } from "./types.js";
import { MCP_FIELD_ALIASES } from "./mcp_schema_normalize.js";
import { toRfc3339DateTime } from "./google_rest_tool_args.js";

function firstDefined(args: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") return args[key];
  }
  return undefined;
}

export function coerceMcpInteger(val: unknown): unknown {
  if (typeof val === "number" && Number.isFinite(val)) return Math.trunc(val);
  if (typeof val === "string" && val.trim()) {
    const n = Number(val.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return val;
}

function coerceMcpBoolean(val: unknown): unknown {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return val;
}

const INTEGER_LIKE_KEYS = new Set([
  "pageSize",
  "page_size",
  "limit",
  "maxResults",
  "max_results",
  "maxResultCount",
  "max_result_count",
]);

/** Fix Drive query language dates: '2024-06-05' → '2024-06-05T00:00:00Z'. */
export function normalizeDriveMcpQuery(query: string): string {
  let out = query;
  out = out.replace(
    /(['"])(\d{4}-\d{2}-\d{2})(?![T\d])/g,
    (_, quote: string, date: string) => `${quote}${date}T00:00:00Z${quote}`
  );
  out = out.replace(
    /(modifiedTime|createdTime|viewedByMeTime)\s*([><=]+)\s*'(\d{4}-\d{2}-\d{2})(?![T\d])'/gi,
    (_m, field: string, op: string, date: string) => `${field} ${op} '${date}T00:00:00Z'`
  );
  return out;
}

function mapAliasesToCanonical(out: Record<string, unknown>): void {
  for (const [canonical, aliases] of Object.entries(MCP_FIELD_ALIASES)) {
    if (out[canonical] !== undefined) continue;
    const val = firstDefined(out, aliases);
    if (val !== undefined) out[canonical] = val;
  }
}

/** Drop harness alias keys once canonical is set — Google MCP 400s on duplicate/extra names. */
function dropMcpAliasKeysAfterMapping(out: Record<string, unknown>): void {
  for (const [canonical, aliases] of Object.entries(MCP_FIELD_ALIASES)) {
    if (out[canonical] === undefined) continue;
    for (const alias of aliases) {
      if (alias !== canonical) delete out[alias];
    }
  }
}

/** Property keys accepted by the remote MCP server (excludes harness-only aliases). */
export function mcpRemotePropertyKeys(
  properties: Record<string, unknown>
): string[] {
  const allAliases = new Set<string>();
  for (const aliases of Object.values(MCP_FIELD_ALIASES)) {
    for (const alias of aliases) allAliases.add(alias);
  }
  return Object.keys(properties).filter((key) => key in MCP_FIELD_ALIASES || !allAliases.has(key));
}

export function pruneMcpArgsToRemoteSchema(
  properties: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const allowed = new Set(mcpRemotePropertyKeys(properties));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (allowed.has(key)) out[key] = val;
  }
  return out;
}

function coerceIntegerFields(
  out: Record<string, unknown>,
  schema?: ToolParameterSchema
): void {
  for (const key of Object.keys(out)) {
    const prop = schema?.properties[key];
    const isInt =
      prop?.type === "integer" ||
      prop?.type === "number" ||
      INTEGER_LIKE_KEYS.has(key);
    if (isInt && out[key] !== undefined) {
      out[key] = coerceMcpInteger(out[key]);
    }
    if (prop?.type === "boolean" && out[key] !== undefined) {
      out[key] = coerceMcpBoolean(out[key]);
    }
  }
}

function normalizeQueryFields(out: Record<string, unknown>, name: string): void {
  const q = firstDefined(out, ["query", "q", "search", "term", "text", "searchQuery"]);
  if (q !== undefined && out["query"] === undefined) out["query"] = q;

  for (const key of ["query", "q", "searchQuery"]) {
    const val = out[key];
    if (typeof val === "string" && val.trim()) {
      if (name.includes("drive") || val.includes("modifiedTime") || val.includes("createdTime")) {
        out[key] = normalizeDriveMcpQuery(val);
      }
    }
  }
}

function normalizeCalendarFields(
  out: Record<string, unknown>,
  name: string,
  schema?: ToolParameterSchema
): void {
  if (!name.includes("calendar")) return;

  const props = schema?.properties ?? {};
  const hasCalendarId = Boolean(props["calendarId"] || props["calendar_id"]);
  if (hasCalendarId) {
    if (!out["calendarId"] && !out["calendar_id"]) {
      out["calendarId"] = "primary";
    } else if (typeof out["calendar_id"] === "string" && !out["calendarId"]) {
      out["calendarId"] = out["calendar_id"];
    }
  }

  for (const key of ["timeMin", "timeMax", "time_min", "time_max", "start", "end"]) {
    if (typeof out[key] === "string") out[key] = toRfc3339DateTime(out[key]);
  }
}

function applyDefaultPageSize(out: Record<string, unknown>, schema?: ToolParameterSchema): void {
  if (!schema?.properties["pageSize"]) return;
  const current = out["pageSize"];
  if (current === undefined || current === null || current === "") {
    out["pageSize"] = 25;
    return;
  }
  const n = coerceMcpInteger(current);
  if (typeof n === "number" && n < 1) out["pageSize"] = 25;
}

export function normalizeGoogleMcpToolArgs(
  name: string,
  args: Record<string, unknown>,
  schema?: ToolParameterSchema
): Record<string, unknown> {
  if (!name.startsWith("mcp_google_")) return args;

  const out = { ...args };
  mapAliasesToCanonical(out);
  dropMcpAliasKeysAfterMapping(out);
  coerceIntegerFields(out, schema);
  normalizeQueryFields(out, name);
  normalizeCalendarFields(out, name, schema);
  applyDefaultPageSize(out, schema);

  if (
    schema?.properties["pageSize"] &&
    out["pageSize"] === undefined &&
    out["limit"] !== undefined
  ) {
    out["pageSize"] = coerceMcpInteger(out["limit"]);
  }

  return out;
}

/** Remove null/undefined and keys not on the remote MCP schema before tools/call. */
export function cleanMcpCallArgs(
  args: Record<string, unknown>,
  remoteProperties?: Record<string, unknown>
): Record<string, unknown> {
  let scoped = args;
  if (remoteProperties) {
    scoped = pruneMcpArgsToRemoteSchema(remoteProperties, scoped);
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(scoped)) {
    if (val !== undefined && val !== null && val !== "") out[key] = val;
  }
  return out;
}
