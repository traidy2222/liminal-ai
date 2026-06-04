/**
 * Classify MCP remote tool names as read vs write for approval policy.
 */

const WRITE_PATTERNS =
  /\b(create|update|delete|send|modify|write|post|put|patch|insert|append|clear|remove|move|copy|rename|label|unlabel|publish|execute|run|deploy|share|upload|set_|add_|make_|batch_update|respond_to)\b/i;

const READ_PATTERNS =
  /\b(get|list|search|read|download|fetch|find|describe|metadata|info|recent|query|lookup|export)\b/i;

export function isMcpWriteTool(remoteName: string, description?: string): boolean {
  const combined = `${remoteName} ${description ?? ""}`;
  if (WRITE_PATTERNS.test(combined)) {
    if (READ_PATTERNS.test(remoteName) && /\b(get|list|search|read|download|fetch)\b/i.test(remoteName)) {
      return false;
    }
    return true;
  }
  return false;
}

export function isMcpReadTool(remoteName: string, description?: string): boolean {
  if (isMcpWriteTool(remoteName, description)) return false;
  const combined = `${remoteName} ${description ?? ""}`;
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
