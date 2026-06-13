/**
 * Managed-inference upstream provider preference (Bedrock vs OpenRouter).
 *
 * Sent to the Vireon proxy as `x-vireon-managed-provider` so hybrid routing can
 * pin a provider while still failing over to the equivalent on the other side.
 */
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export type ManagedInferenceProviderRef = {
  provider: "bedrock" | "openrouter" | "kimchi";
  id: string;
};

export const VIREON_MANAGED_PROVIDER_HEADER = "x-vireon-managed-provider";

export type ManagedProviderPreference = "auto" | "bedrock" | "openrouter" | "kimchi";

const BEDROCK_GEO_PREFIX = /^(us|eu|global|au|jp|ap)-?\./i;

const KIMCHI_MODEL_PREFIX = /^(kimi-|minimax-|nemotron-)/i;

function looksLikeKimchiManagedModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m || m.includes("/")) return false;
  return KIMCHI_MODEL_PREFIX.test(m);
}

function looksLikeBedrockModelId(model: string): boolean {
  const m = model.trim();
  if (!m || looksLikeKimchiManagedModelId(m)) return false;
  if (BEDROCK_GEO_PREFIX.test(m)) return true;
  return m.includes(".") && !m.includes("/");
}

/** When the API omits `providers[]`, infer from id shape (legacy / Bedrock-only catalog). */
export function inferManagedModelProviders(
  id: string,
  existing?: ManagedInferenceProviderRef[] | null
): ManagedInferenceProviderRef[] {
  if (existing?.length) return existing;
  const trimmed = id.trim();
  if (!trimmed) return [];
  if (looksLikeKimchiManagedModelId(trimmed)) return [{ provider: "kimchi", id: trimmed }];
  if (looksLikeBedrockModelId(trimmed)) return [{ provider: "bedrock", id: trimmed }];
  if (trimmed.includes("/")) return [{ provider: "openrouter", id: trimmed }];
  return [{ provider: "openrouter", id: trimmed }];
}

export function managedModelAvailableOnProvider(
  providers: ManagedInferenceProviderRef[],
  preference: ManagedProviderPreference
): boolean {
  if (preference === "auto") return true;
  return providers.some((p) => p.provider === preference);
}

export function filterManagedCatalogForProvider<
  T extends { id: string; providers?: ManagedInferenceProviderRef[] },
>(models: T[], preference: ManagedProviderPreference): Array<T & { providers: ManagedInferenceProviderRef[] }> {
  const normalized = models.map((m) => ({
    ...m,
    providers: inferManagedModelProviders(m.id, m.providers),
  }));
  if (preference === "auto") return normalized;
  return normalized.filter((m) => managedModelAvailableOnProvider(m.providers, preference));
}

export function catalogPickerValueForManagedProvider(
  row: { id: string; providers?: ManagedInferenceProviderRef[] },
  preference: ManagedProviderPreference
): string {
  const providers = inferManagedModelProviders(row.id, row.providers);
  return resolveModelIdForManagedProvider(row.id, preference, providers);
}

export function displayLabelForManagedCatalogRow(
  row: { id: string; label: string; providers?: ManagedInferenceProviderRef[] },
  preference: ManagedProviderPreference
): string {
  const providers = inferManagedModelProviders(row.id, row.providers);
  const slug = resolveModelIdForManagedProvider(row.id, preference, providers);
  if (preference !== "auto") return slug;
  return row.label.trim() || row.id;
}

export function findManagedCatalogRowByModelId<
  T extends { id: string; providers?: ManagedInferenceProviderRef[] },
>(models: T[], modelId: string): (T & { providers: ManagedInferenceProviderRef[] }) | undefined {
  const needle = modelId.trim();
  if (!needle) return undefined;
  for (const row of models) {
    const providers = inferManagedModelProviders(row.id, row.providers);
    if (row.id === needle || providers.some((p) => p.id === needle)) {
      return { ...row, providers };
    }
  }
  return undefined;
}

export function remapManagedModelIdForProvider(
  currentModelId: string,
  nextPreference: ManagedProviderPreference,
  models: Array<{ id: string; providers?: ManagedInferenceProviderRef[] }>
): string {
  const current = currentModelId.trim();
  if (!current || nextPreference === "auto") return currentModelId;
  const row = findManagedCatalogRowByModelId(models, current);
  if (!row) return currentModelId;
  return resolveModelIdForManagedProvider(row.id, nextPreference, row.providers);
}

export function managedCatalogHasProvider(
  models: Array<{ id: string; providers?: ManagedInferenceProviderRef[] }>,
  provider: ManagedProviderPreference
): boolean {
  if (provider === "auto") return models.length > 0;
  return models.some((m) =>
    managedModelAvailableOnProvider(inferManagedModelProviders(m.id, m.providers), provider)
  );
}

/** Actionable copy when a pinned provider filter yields zero rows. */
export function emptyManagedProviderFilterMessage(
  models: Array<{ id: string; providers?: ManagedInferenceProviderRef[] }>,
  preference: ManagedProviderPreference,
  upstream?: string | null
): string {
  if (preference === "auto" || models.length === 0) {
    return preference === "openrouter"
      ? "No OpenRouter models in the managed catalog."
      : preference === "bedrock"
        ? "No Bedrock models in the managed catalog."
        : preference === "kimchi"
          ? "No Kimchi (Cast AI) models in the managed catalog."
          : "No managed models returned.";
  }
  const hasMeta = models.some((m) => (m.providers?.length ?? 0) > 0);
  const upstreamHint = upstream?.trim().toLowerCase();
  if (preference === "openrouter" && !managedCatalogHasProvider(models, "openrouter")) {
    if (!hasMeta || upstreamHint === "bedrock") {
      return (
        "OpenRouter catalog not available from Vireon yet — the server is still returning " +
        "Bedrock-only models (no providers[] merge). Use Auto/Bedrock, or deploy the hybrid " +
        "inference API with VIREON_OPENROUTER_API_KEY on the control plane."
      );
    }
    return "No OpenRouter models in the merged catalog for this account.";
  }
  if (preference === "bedrock" && !managedCatalogHasProvider(models, "bedrock")) {
    return "No Bedrock models in the managed catalog for this account.";
  }
  if (preference === "kimchi" && !managedCatalogHasProvider(models, "kimchi")) {
    return "No Kimchi (Cast AI) models in the managed catalog. Deploy models in Cast AI or check VIREON_KIMCHI_API_KEY on the control plane.";
  }
  return `No models on ${preference} for this account.`;
}

export function resolveManagedProviderPreference(
  prefs?: RuntimePreferences | null | undefined
): ManagedProviderPreference {
  const raw = resolveHarnessEnvRaw("AGENT_MANAGED_PROVIDER", prefs ?? null)?.trim().toLowerCase();
  if (raw === "bedrock" || raw === "openrouter" || raw === "kimchi") return raw;
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
  const hasKimchi = providers.some((p) => p.provider === "kimchi");
  if (hasBedrock && hasOr && hasKimchi) return "BR+OR+KC";
  if (hasBedrock && hasOr) return "BR+OR";
  if (hasBedrock && hasKimchi) return "BR+KC";
  if (hasOr && hasKimchi) return "OR+KC";
  if (hasBedrock) return "BR";
  if (hasOr) return "OR";
  if (hasKimchi) return "KC";
  return null;
}
