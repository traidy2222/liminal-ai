/**
 * Vault curator idle gating (orchestration lives in vault_curate tool).
 */
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export function resolveVaultCurateOnIdleConfig(prefs: RuntimePreferences | null = null): {
  enabled: boolean;
  intervalMs: number;
} {
  const enabled = resolveHarnessEnvRaw("AGENT_VAULT_CURATE_ON_IDLE", prefs) !== "0";
  const raw = resolveHarnessEnvRaw("AGENT_VAULT_CURATE_INTERVAL_MS", prefs)?.trim();
  const n = raw ? parseInt(raw, 10) : 600_000;
  const intervalMs = Number.isFinite(n) ? Math.max(60_000, Math.min(86_400_000, n)) : 600_000;
  return { enabled, intervalMs };
}

/** Env patch for Settings “Obsidian Brain (safe)” preset. */
export const OBSIDIAN_BRAIN_SAFE_ENV: Record<string, string> = {
  AGENT_VAULT_AGENT_PREFIX: "_liminal",
  AGENT_VAULT_DEDUPE: "1",
  AGENT_VAULT_REQUIRE_LINKS: "1",
  AGENT_VAULT_CURATE_ON_IDLE: "1",
  AGENT_VAULT_ENTITY_EXTRACT: "1",
  AGENT_VAULT_AUTO_WRITE: "research",
  AGENT_CONSOLIDATE_ON_IDLE: "1",
};
