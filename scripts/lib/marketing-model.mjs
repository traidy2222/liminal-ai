/**
 * Marketing captures run on a pinned model for deterministic output.
 * Default: the repo's main model (deepseek/deepseek-v4-pro). The old
 * `openrouter/owl-alpha` stealth slug is delisted — pinning it made every
 * capture turn fail silently (empty transcript, 0 tools).
 * Override with MARKETING_AGENT_MODEL / MARKETING_SKIP_MODEL=1.
 */

export const MARKETING_AGENT_MODEL =
  process.env.MARKETING_AGENT_MODEL?.trim() || "deepseek/deepseek-v4-pro";

const OPENROUTER_V1 = "https://openrouter.ai/api/v1";

/** Stealth provider pin only applies to owl/stealth slugs. */
const IS_STEALTH = /owl|stealth/i.test(MARKETING_AGENT_MODEL);

export function marketingModelEnvPatch() {
  const model = MARKETING_AGENT_MODEL;
  return {
    AGENT_MODEL: model,
    AGENT_FAST_MODEL: model,
    AGENT_SAFETY_JUDGE_MODEL: model,
    AGENT_MEMORY_AUTOLINK_MODEL: model,
    AGENT_MEMORY_CONSOLIDATE_MODEL: model,
    AGENT_API_BASE_URL: OPENROUTER_V1,
    ...(IS_STEALTH
      ? {
          AGENT_PROVIDER_STRATEGY: "cache_first",
          AGENT_PROVIDER_ORDER: "Stealth",
          AGENT_PROVIDER_ORDER_FAST: "Stealth",
          AGENT_PROVIDER_ROUTE_AUTO: "0",
          AGENT_PROVIDER_ALLOW_FALLBACKS: "0",
        }
      : {}),
  };
}

/** For child processes (liminal_desktop → liminald). */
export function applyMarketingModelToProcessEnv() {
  // Desktop shell auto-opens the chat workspace when the sidecar activates a
  // marketing chat. Must be set even with MARKETING_SKIP_MODEL=1 — otherwise
  // frames capture the home hub instead of the live transcript.
  process.env.LIMINAL_MARKETING_CAPTURE = "1";
  if (process.env.MARKETING_SKIP_MODEL === "1") {
    return { model: process.env.AGENT_MODEL?.trim() || "(unchanged)", skipped: true };
  }
  const patch = marketingModelEnvPatch();
  for (const [k, v] of Object.entries(patch)) {
    process.env[k] = v;
  }
  return { model: MARKETING_AGENT_MODEL, patch, skipped: false };
}

export function marketingModelManifestFields() {
  if (process.env.MARKETING_SKIP_MODEL === "1") {
    return { model: process.env.AGENT_MODEL?.trim() || null, providerOrder: null };
  }
  return {
    model: MARKETING_AGENT_MODEL,
    providerOrder: "Stealth",
    apiBaseURL: OPENROUTER_V1,
  };
}

/**
 * @param {string} apiBase
 * @param {(base: string, route: string, init?: object) => Promise<object>} apiJson
 */
export async function ensureMarketingModelLive(apiBase, apiJson) {
  if (process.env.MARKETING_SKIP_MODEL === "1") {
    console.log("[marketing] MARKETING_SKIP_MODEL=1 — using harness model as-is");
    return;
  }
  const patch = marketingModelEnvPatch();
  console.log(`[marketing] Model → ${MARKETING_AGENT_MODEL} (Stealth)`);
  await apiJson(apiBase, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      harness: { env: patch },
      provider: { model: MARKETING_AGENT_MODEL },
    }),
  });
}

/**
 * @param {import("./sidecar-ws-client.mjs").SidecarWsClient} client
 */
export async function ensureMarketingModelSidecar(client) {
  if (process.env.MARKETING_SKIP_MODEL === "1") {
    console.log("[marketing] MARKETING_SKIP_MODEL=1 — using harness model as-is");
    return;
  }
  const patch = marketingModelEnvPatch();
  console.log(`[marketing] Model → ${MARKETING_AGENT_MODEL} (Stealth)`);
  const result = await client.sendCommand("update_settings", {
    patch: {
      harness: { env: patch },
      provider: { model: MARKETING_AGENT_MODEL },
    },
  });
  if (!result.ok) {
    throw new Error(result.error ?? "update_settings failed for marketing model");
  }
  await client.waitHarnessIdle(60_000).catch(() => {});
}
