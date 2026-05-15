/**
 * Single source of truth for the Obsidian / agent vault root directory.
 * Mirrors packages/tools/src/vault_store.ts behaviour (tools imports from here).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { discoverObsidianVaultPathFromAppData } from "./obsidian_vault_discovery.js";

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
 * after normalization; otherwise undefined (see `getAgentVaultRoot()` for Obsidian
 * auto-detect and `~/.agent_vault` fallback).
 */
export function getExplicitAgentVaultPathFromEnv(): string | undefined {
  const env = effectiveHarnessEnvRaw("AGENT_VAULT_PATH");
  if (env === undefined) return undefined;
  const s = normalizeAgentVaultRawPath(env);
  return s.length > 0 ? s : undefined;
}

/** Absolute vault root: explicit `AGENT_VAULT_PATH`, else Obsidian auto-detect, else `~/.agent_vault`. */
export function getAgentVaultRoot(): string {
  const explicit = getExplicitAgentVaultPathFromEnv();
  if (explicit) return explicit;
  if (effectiveHarnessEnvRaw("AGENT_OBSIDIAN_DISCOVER") === "0") {
    return join(homedir(), ".agent_vault");
  }
  const discovered = discoverObsidianVaultPathFromAppData({
    requireDotObsidian: effectiveHarnessEnvRaw("AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN") !== "0",
    nameSubstring: effectiveHarnessEnvRaw("AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING")?.trim() || undefined,
  });
  if (discovered) return discovered;
  return join(homedir(), ".agent_vault");
}
