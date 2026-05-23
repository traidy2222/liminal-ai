import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * AsyncLocalStorage scope holding the workspace root for the current async
 * chain. Set by `runWithWorkspaceRoot()` (typically `AgentHarness.send()`),
 * propagates through `await` / Promise.then automatically. Lets every
 * sub-agent — and the file tools called inside it — operate on its own root.
 */
const workspaceContext = new AsyncLocalStorage<string>();

/**
 * Run `fn` (sync or async) with `root` as the current workspace root. All
 * `resolveWorkspaceRoot()` calls inside the async scope return `root`. Used by
 * the harness to scope a send() to its own workspace so parallel sub-agents
 * can operate on isolated trees (e.g. git worktrees).
 */
export function runWithWorkspaceRoot<T>(root: string, fn: () => T): T {
  return workspaceContext.run(path.resolve(root), fn);
}

/**
 * Monorepo / project root for world context, agent notes, artifacts, and tool defaults.
 * Resolution order:
 *   1. Active ALS scope (set by `runWithWorkspaceRoot`) — per-harness root.
 *   2. `AGENT_WORKSPACE_ROOT` environment variable.
 *   3. `process.cwd()`.
 */
export function resolveWorkspaceRoot(): string {
  const scoped = workspaceContext.getStore();
  if (scoped) return scoped;
  const raw = process.env["AGENT_WORKSPACE_ROOT"]?.trim();
  if (raw) return path.resolve(raw);
  return process.cwd();
}
