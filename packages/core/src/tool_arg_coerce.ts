import type { PropertySchema, ToolParameterSchema } from "./types.js";

/** Parse model-emitted JSON that may be double-encoded or a single object. */
export function coerceJsonArrayValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (typeof item === "string") {
        const inner = tryParseJson(item);
        if (inner && typeof inner === "object") return inner;
      }
      return item;
    });
  }
  if (typeof val === "string") {
    const parsed = tryParseJson(val.trim());
    if (Array.isArray(parsed)) return coerceJsonArrayValue(parsed);
    if (parsed && typeof parsed === "object") return [parsed];
  }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return [val];
  }
  return val;
}

function tryParseJson(s: string): unknown | undefined {
  if (!s) return undefined;
  if (!(s.startsWith("[") || s.startsWith("{") || s.startsWith('"'))) return undefined;
  try {
    let parsed: unknown = JSON.parse(s);
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (inner.startsWith("[") || inner.startsWith("{")) {
        parsed = JSON.parse(inner) as unknown;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Models sometimes pass JSON arrays/objects as strings. Coerce before schema validation.
 */
export function coerceValueToSchema(val: unknown, schema: PropertySchema): unknown {
  if (schema.anyOf && schema.anyOf.length > 0) {
    for (const branch of schema.anyOf) {
      const coerced = coerceValueToSchema(val, { ...branch, anyOf: undefined });
      const actual = Array.isArray(coerced) ? "array" : typeof coerced;
      if (branch.type && actual === branch.type) return coerced;
      if (!branch.type) return coerced;
    }
    // Prefer array coercion when any branch is array
    if (schema.anyOf.some((b) => b.type === "array")) {
      const asArray = coerceJsonArrayValue(val);
      if (Array.isArray(asArray)) return asArray;
    }
  }

  if (schema.type === "array") {
    const coerced = coerceJsonArrayValue(val);
    if (Array.isArray(coerced) && schema.items) {
      return coerced.map((item) => coerceValueToSchema(item, schema.items!));
    }
    if (Array.isArray(coerced)) return coerced;
  }

  if (schema.type === "object" && typeof val === "string") {
    const parsed = tryParseJson(val.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }

  if (schema.type === "string") {
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
    if (typeof val === "boolean") return String(val);
  }

  if (schema.type === "integer" || schema.type === "number") {
    if (typeof val === "string" && val.trim()) {
      const n = Number(val.trim());
      if (Number.isFinite(n)) {
        return schema.type === "integer" ? Math.trunc(n) : n;
      }
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      return schema.type === "integer" ? Math.trunc(val) : val;
    }
  }

  return val;
}

export function coerceArgsToSchema(
  schema: ToolParameterSchema,
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (key in out) out[key] = coerceValueToSchema(out[key], propSchema);
  }
  return out;
}

/** Drop keys not declared in the tool schema (after alias normalization). */
export function pruneArgsToSchema(
  schema: ToolParameterSchema,
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (key in schema.properties) out[key] = val;
  }
  return out;
}
