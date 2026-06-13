/**
 * Managed-inference upstream provider preference (Bedrock vs OpenRouter).
 *
 * Sent to the Vireon proxy as `x-vireon-managed-provider` so hybrid routing can
 * pin a provider while still failing over to the equivalent on the other side.
 */
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export type ManagedInferenceProviderRef = {
  provider: "bedrock" | "openrouter";
  id: string;
};

export const VIREON_MANAGED_PROVIDER_HEADER = "x-vireon-managed-provider";

export type ManagedProviderPreference = "auto" | "bedrock" | "openrouter";

export function resolveManagedProviderPreference(
  prefs?: RuntimePreferences | null | undefined
): ManagedProviderPreference {
  const raw = resolveHarnessEnvRaw("AGENT_MANAGED_PROVIDER", prefs ?? null)?.trim().toLowerCase();
  if (raw === "bedrock" || raw === "openrouter") return raw;
  return "auto";
}

/** Request headers for managed-inference chat completions (omit when `auto`). */
export function buildManagedInferenceRequestHeaders(
  prefs?: RuntimePreferences | null | undefined
): Record<string, string> {
  const pref = resolveManagedProviderPreference(prefs);
  if (pref === "auto") return {};
  return { [VIREON_MANAGED_PROVIDER_HEADER]: pref };
}

/**
 * When the catalog lists multiple providers for one logical model, pick the id
 * to store in AGENT_MODEL for the active provider preference.
 */
export function resolveModelIdForManagedProvider(
  displayId: string,
  preference: ManagedProviderPreference,
  providers?: ManagedInferenceProviderRef[] | null
): string {
  if (!providers?.length || preference === "auto") return displayId;
  const hit = providers.find((p) => p.provider === preference);
  return hit?.id?.trim() || displayId;
}

/** Provider badges for UI (`BR` / `OR` / `BR+OR`). */
export function formatManagedModelProviderBadge(
  providers?: ManagedInferenceProviderRef[] | null
): string | null {
  if (!providers?.length) return null;
  const hasBedrock = providers.some((p) => p.provider === "bedrock");
  const hasOr = providers.some((p) => p.provider === "openrouter");
  if (hasBedrock && hasOr) return "BR+OR";
  if (hasBedrock) return "BR";
  if (hasOr) return "OR";
  return null;
}
