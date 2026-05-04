/**
 * Single source of truth for the Obsidian / agent vault root directory.
 * Mirrors packages/tools/src/vault_store.ts behaviour (tools imports from here).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Strip surrounding quotes and trim (common in .env on Windows). */
export function normalizeAgentVaultRawPath(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (/^file:/i.test(s)) {
    try {
      return fileURLToPath(new URL(s));
    } catch {
      try {
        return fileURLToPath(s);
      } catch {
        return s;
      }
    }
  }
  return s;
}

/**
 * Returns the vault directory if `AGENT_VAULT_PATH` is set to a non-empty value
 * after normalization; otherwise undefined (caller may fall back to ~/.agent_vault).
 */
export function getExplicitAgentVaultPathFromEnv(): string | undefined {
  const env = process.env["AGENT_VAULT_PATH"];
  if (env === undefined) return undefined;
  const s = normalizeAgentVaultRawPath(env);
  return s.length > 0 ? s : undefined;
}

/** Absolute vault root: explicit `AGENT_VAULT_PATH` or `~/.agent_vault`. */
export function getAgentVaultRoot(): string {
  return getExplicitAgentVaultPathFromEnv() ?? join(homedir(), ".agent_vault");
}
