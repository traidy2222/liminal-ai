/**
 * Harness model-pack env patches — no provider_backends / preset catalog deps
 * (breaks circular import: managed_free_fallback ↔ provider_model_presets).
 */

/** Patch main + fast model slots (embeddings/vision stay on product defaults). */
export function buildHarnessModelPackEnvPatch(opts: {
  main: string;
  fast: string;
  baseURL?: string;
  providerStrategy?: string;
  providerOrder?: string;
  providerOrderFast?: string;
  providerRouteAuto?: string;
  allowFallbacks?: string;
}): Record<string, string> {
  const fast = opts.fast.trim();
  const main = opts.main.trim();
  const patch: Record<string, string> = {
    AGENT_MODEL: main,
    AGENT_FAST_MODEL: fast,
    AGENT_SAFETY_JUDGE_MODEL: fast,
    AGENT_MEMORY_AUTOLINK_MODEL: fast,
    AGENT_MEMORY_CONSOLIDATE_MODEL: fast,
  };
  if (opts.baseURL !== undefined) patch.AGENT_API_BASE_URL = opts.baseURL;
  if (opts.providerStrategy !== undefined) patch.AGENT_PROVIDER_STRATEGY = opts.providerStrategy;
  if (opts.providerOrder !== undefined) patch.AGENT_PROVIDER_ORDER = opts.providerOrder;
  if (opts.providerOrderFast !== undefined) patch.AGENT_PROVIDER_ORDER_FAST = opts.providerOrderFast;
  if (opts.providerRouteAuto !== undefined) patch.AGENT_PROVIDER_ROUTE_AUTO = opts.providerRouteAuto;
  if (opts.allowFallbacks !== undefined) patch.AGENT_PROVIDER_ALLOW_FALLBACKS = opts.allowFallbacks;
  return patch;
}
