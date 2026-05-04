import path from "node:path";

/**
 * Monorepo / project root for world context, agent notes, artifacts, and tool defaults.
 * Set `AGENT_WORKSPACE_ROOT` to override; otherwise uses `process.cwd()`.
 */
export function resolveWorkspaceRoot(): string {
  const raw = process.env["AGENT_WORKSPACE_ROOT"]?.trim();
  if (raw) return path.resolve(raw);
  return process.cwd();
}
