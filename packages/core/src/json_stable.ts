/** Deterministic JSON-ish string for cache keys and tool-call dedup. */
export function stableStringifyValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringifyValue(v)).join(",")}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyValue(o[k])}`).join(",")}}`;
}

export function stableArgsJsonKey(argsJson: string): string {
  try {
    return stableStringifyValue(JSON.parse(argsJson) as unknown);
  } catch {
    return argsJson;
  }
}
