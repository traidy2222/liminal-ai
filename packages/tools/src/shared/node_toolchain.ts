/**
 * Resolve Node toolchain binaries (tsc, eslint, …) for run_lint and similar tools.
 *
 * Isolated workspaces (eval sandboxes, git worktrees) often lack their own
 * node_modules/.bin — fall back to the nearest install, then the tools package.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";

const require = createRequire(import.meta.url);

function binName(tool: string): string {
  return process.platform === "win32" ? `${tool}.cmd` : tool;
}

function localBin(tool: string, dir: string): string | null {
  const p = path.join(dir, "node_modules", ".bin", binName(tool));
  return existsSync(p) ? p : null;
}

/** Walk from startDir upward looking for node_modules/.bin/{tool}. */
export function findNearestNodeBin(tool: string, startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const hit = localBin(tool, dir);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve a package CLI entry (e.g. typescript/bin/tsc) from the tools install. */
export function resolvePackageCli(packageSubpath: string): string {
  return require.resolve(packageSubpath);
}

/**
 * Best-effort executable for a Node CLI tool.
 * Prefers cwd-local .bin, then ancestors, then bundled package bin.
 */
export function resolveNodeToolExec(
  tool: string,
  packageCliSubpath: string,
  cwd: string
): { command: string; argsPrefix: string[] } {
  const nearest =
    localBin(tool, cwd) ??
    findNearestNodeBin(tool, cwd) ??
    findNearestNodeBin(tool, resolveWorkspaceRoot());

  if (nearest) {
    return { command: nearest, argsPrefix: [] };
  }

  const cliJs = resolvePackageCli(packageCliSubpath);
  return { command: process.execPath, argsPrefix: [cliJs] };
}
