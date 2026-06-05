/**
 * Load `.env` for harness processes (CLI, liminald, probes).
 * dotenv does not override keys already set in `process.env`.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const loaded = new Set<string>();

function tryLoad(filePath: string, out: string[]): void {
  const resolved = resolve(filePath);
  if (!existsSync(resolved) || loaded.has(resolved)) return;
  loaded.add(resolved);
  config({ path: resolved });
  out.push(resolved);
}

/**
 * Load harness `.env` files. Call before OAuth token reads or provider resolution.
 * Recommended for desktop: `~/.liminal/.env` with the same `AGENT_API_KEY` used at connect time.
 */
export function loadHarnessEnvFiles(opts?: { repoRoot?: string; cwd?: string }): string[] {
  const paths: string[] = [];

  const extra = process.env["LIMINAL_EXTRA_ENV"]?.trim();
  if (extra) tryLoad(extra, paths);

  tryLoad(join(homedir(), ".liminal", ".env"), paths);

  const repoRoot = opts?.repoRoot?.trim();
  if (repoRoot) {
    tryLoad(join(repoRoot, ".env"), paths);
    tryLoad(join(repoRoot, "packages", "web", ".env"), paths);
  }

  const cwd = opts?.cwd?.trim() || process.cwd();
  tryLoad(join(cwd, ".env"), paths);

  return paths;
}
