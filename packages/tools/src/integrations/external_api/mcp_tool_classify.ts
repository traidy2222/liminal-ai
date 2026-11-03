/**
 * Classify MCP remote tool names as read vs write for approval policy.
 */

const WRITE_PATTERNS =
  /\b(create|update|delete|send|modify|write|post|put|patch|insert|append|clear|remove|move|copy|rename|label|unlabel|publish|execute|run|deploy|share|upload|set|add|make|respond|trash|untrash|mark|unmark|reply|forward|archive|restore|subscribe|unsubscribe)\b/i;

const READ_PATTERNS =
  /\b(get|list|search|read|download|fetch|find|describe|metadata|info|recent|query|lookup|export)\b/i;

/** MCP tool names use snake_case; word-boundary regex misses `read_foo` — normalize first. */
function normalizeMcpName(remoteName: string): string {
  return remoteName.replace(/_/g, " ");
}

export function isMcpWriteTool(remoteName: string, description?: string): boolean {
  const name = normalizeMcpName(remoteName);
  // "run" in get_workflow_run is a resource noun; mark_read is still a write.
  if (/^(get|list|search|read|download|fetch)\b/i.test(name)) {
    return [...name.matchAll(/\b(?:and|or|then)\s+(?:batch\s+)?(\w+)/gi)]
      .some(match => WRITE_PATTERNS.test(match[1]!));
  }
  if (WRITE_PATTERNS.test(name)) return true;
  if (/\b(get|list|search|read|download|fetch)\b/i.test(name)) return false;
  return WRITE_PATTERNS.test(normalizeMcpName(description ?? ""));
}

export function isMcpReadTool(remoteName: string, description?: string): boolean {
  if (isMcpWriteTool(remoteName, description)) return false;
  const combined = `${normalizeMcpName(remoteName)} ${description ?? ""}`;
  return READ_PATTERNS.test(combined);
}

export interface McpToolFilter {
  include?: string[];
  exclude?: string[];
}

export function filterMcpToolRecords<T extends { remoteName: string }>(
  tools: T[],
  opts: { readOnly?: boolean; toolFilter?: McpToolFilter }
): T[] {
  let out = tools;
  const filter = opts.toolFilter;
  if (filter?.include?.length) {
    const want = new Set(filter.include.map((s) => s.toLowerCase()));
    out = out.filter((t) => want.has(t.remoteName.toLowerCase()));
  }
  if (filter?.exclude?.length) {
    const skip = new Set(filter.exclude.map((s) => s.toLowerCase()));
    out = out.filter((t) => !skip.has(t.remoteName.toLowerCase()));
  }
  if (opts.readOnly) {
    out = out.filter((t) => !isMcpWriteTool(t.remoteName));
  }
  return out;
}
