/** Browser-safe managed model filtering; no credentials or provider clients. */
import type { ManagedProviderPreference, ManagedInferenceModel } from "./inference_provider.js";
export type { ManagedInferenceModel } from "./inference_provider.js";

export function parseManagedProviderPreference(raw: string | undefined): ManagedProviderPreference {
  const v = raw?.trim().toLowerCase();
  if (v === "bedrock" || v === "openrouter" || v === "kimchi") return v;
  return "auto";
}

const BEDROCK_GEO_PREFIX = /^(us|eu|global|apac|au|jp)\./i;

/** True when the slug is a flat Cast AI / Kimchi id (no vendor slash). */
export function looksLikeKimchiModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m || m.includes("/")) return false;
  if (/^(kimi-|minimax-|nemotron-)/.test(m)) return true;
  return !m.includes(".");
}

/** True when the slug is already a Bedrock model / inference-profile id. */
export function looksLikeBedrockModelId(model: string): boolean {
  const m = model.trim();
  if (!m || looksLikeKimchiModelId(m)) return false;
  if (BEDROCK_GEO_PREFIX.test(m)) return true;
  return m.includes(".") && !m.includes("/");
}

/** The provider a model id natively belongs to, by shape alone. */
export function modelNativeManagedProvider(
  model: string
): Exclude<ManagedProviderPreference, "auto"> {
  if (looksLikeBedrockModelId(model)) return "bedrock";
  if (looksLikeKimchiModelId(model)) return "kimchi";
  return "openrouter";
}

export function narrowManagedModelForProvider(
  model: ManagedInferenceModel,
  preference: Exclude<ManagedProviderPreference, "auto">
): ManagedInferenceModel | null {
  const providers = model.providers ?? [];
  const ref = providers.find((p) => p.provider === preference && p.id.trim().length > 0);
  if (ref) {
    return {
      ...model,
      id: ref.id,
      providers: [ref],
    };
  }
  if (providers.length > 0) return null;
  if (modelNativeManagedProvider(model.id) !== preference) return null;
  return {
    ...model,
    providers: [{ provider: preference, id: model.id }],
  };
}

/** Filter merged catalog rows to models reachable on the selected managed upstream. */
export function filterManagedInferenceCatalog(
  models: ManagedInferenceModel[],
  preference: ManagedProviderPreference | string | null | undefined
): ManagedInferenceModel[] {
  const pref =
    typeof preference === "string"
      ? parseManagedProviderPreference(preference)
      : (preference ?? "auto");
  if (pref === "auto") return models;
  const out: ManagedInferenceModel[] = [];
  for (const model of models) {
    const narrowed = narrowManagedModelForProvider(model, pref);
    if (narrowed) out.push(narrowed);
  }
  return out;
}
