/**
 * Unified tool-arg pipeline: normalize → coerce → prune → validate.
 * Fixes "expected array, got string" and "Unknown field" failures from model arg shapes.
 */
import type { ToolParameterSchema } from "./types.js";
import {
  mcpRemotePropertyKeys,
  normalizeGoogleMcpToolArgs,
  pruneMcpArgsToRemoteSchema,
} from "./google_mcp_tool_args.js";
import {
  normalizeGoogleRestToolArgs,
  validateGoogleRestToolArgs,
} from "./google_rest_tool_args.js";
import { normalizeLinearRestToolArgs, validateLinearToolArgs } from "./linear_tool_args.js";
import { normalizeSlackRestToolArgs } from "./slack_tool_args.js";
import { coerceArgsToSchema, pruneArgsToSchema } from "./tool_arg_coerce.js";

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Cross-tool aliases not tied to a single integration. */
function normalizeCommonToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };

  if (name === "compress_context") {
    const summary = firstString(out, ["summary", "text", "message", "content", "description"]);
    if (summary) out.summary = summary;
  }

  if (name === "speak") {
    const text = firstString(out, ["text", "content", "message"]);
    if (text) out.text = text;
  }

  return out;
}

function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  let out = normalizeCommonToolArgs(name, args);

  if (name === "speak") return out;

  if (
    name.startsWith("sheets_rest_") ||
    name.startsWith("calendar_rest_") ||
    name.startsWith("docs_rest_") ||
    name.startsWith("slides_rest_") ||
    name.startsWith("office_rest_") ||
    name.startsWith("gmail_")
  ) {
    out = normalizeGoogleRestToolArgs(name, out);
  }
  if (name.startsWith("slack_")) {
    out = normalizeSlackRestToolArgs(name, out);
  }
  if (name.startsWith("linear_")) {
    out = normalizeLinearRestToolArgs(name, out);
  }

  return out;
}

export type ToolArgsPrepResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

/** Normalize, coerce types, and strip unknown keys (when schema is strict). */
export function prepareToolArgsForValidation(
  name: string,
  args: Record<string, unknown>,
  schema: ToolParameterSchema
): ToolArgsPrepResult {
  let out = normalizeToolArgs(name, args);

  if (name.startsWith("linear_")) {
    const linearErr = validateLinearToolArgs(name, out);
    if (linearErr) return { ok: false, error: linearErr };
  }

  if (name.startsWith("mcp_google_")) {
    out = normalizeGoogleMcpToolArgs(name, out, schema);
    // Google MCP returns HTTP 400 for unknown JSON fields — strip aliases + hallucinations.
    out = pruneMcpArgsToRemoteSchema(schema.properties, out);
  }

  // Coerce BEFORE prune so JSON strings become arrays/objects first.
  out = coerceArgsToSchema(schema, out);

  const googleRestErr = validateGoogleRestToolArgs(name, out);
  if (googleRestErr) return { ok: false, error: googleRestErr };

  if (schema.additionalProperties === false || name.startsWith("mcp_google_")) {
    const pruneSchema =
      name.startsWith("mcp_google_")
        ? {
            type: "object" as const,
            properties: Object.fromEntries(
              mcpRemotePropertyKeys(schema.properties).map((key) => [key, schema.properties[key]!])
            ),
          }
        : schema;
    out = pruneArgsToSchema(pruneSchema, out);
  }

  return { ok: true, args: out };
}
