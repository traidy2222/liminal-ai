/**
 * Load `.env` for CLI commands (connect google, login, etc.).
 * Mirrors packages/web/server/index.ts precedence without overriding existing process.env.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { envPath, resolveRepoRoot } from "./paths.mjs";

/** @param {string} filePath */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  config({ path: filePath });
  return true;
}

/** @returns {string[]} paths that were loaded */
export function loadEnvForCli() {
  const loaded = [];
  const seen = new Set();

  /** @param {string} p */
  const add = (p) => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (loadEnvFile(resolved)) loaded.push(resolved);
  };

  const repoRoot = resolveRepoRoot();
  add(envPath(repoRoot));
  add(path.join(repoRoot, "packages", "web", ".env"));
  add(path.join(process.cwd(), ".env"));

  const extra = process.env.LIMINAL_EXTRA_ENV?.trim();
  if (extra) add(extra);

  // Optional sibling checkout (common on this machine: dreamthedream + vireondynamics-website)
  add(path.join(repoRoot, "..", "vireondynamics-website", ".env"));
  add(path.join(os.homedir(), "vireondynamics-website", ".env"));
  add(path.join(os.homedir(), ".liminal", ".env"));

  return loaded;
}
