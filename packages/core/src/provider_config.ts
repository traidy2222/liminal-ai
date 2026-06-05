import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
  HARNESS_ENV_DEFAULTS,
} from "./harness_default_constants.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { resolveManagedOpenRouterCredentials } from "./inference_provider.js";
import {
  buildOpenRouterSessionExtras,
  supportsOpenRouterRequestExtras,
} from "./openrouter_session.js";
import type { ProviderRouteState } from "./provider_route_state.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { ensureLocalProviderApiKeyInProcess } from "./provider_api_key.js";

// ─── Provider routing (OpenRouter sticky cache + dynamic price sort) ─────────

export type ProviderSortAxis = "price" | "throughput" | "latency";

export type ProviderStrategy =
  | "adaptive"
  | "price"
  | "cache_first"
  | "openrouter_default"
  | "throughput"
  | "latency";

/** OpenRouter `provider` preferences object on chat completion requests. */
export interface ProviderRouting {
  order?: string[];
  allow_fallbacks?: boolean;
  sort?: ProviderSortAxis | { by: ProviderSortAxis; partition?: "model" | "none" };
  ignore?: string[];
  only?: string[];
  max_price?: { prompt?: number; completion?: number };
  require_parameters?: boolean;
}

export interface ProviderRoutingContext {
  modelSlug: string;
  isFastModel?: boolean;
  routeState?: ProviderRouteState;
  retryAttempt?: number;
}

/** Map model slug prefix → OpenRouter provider display name. */
const SLUG_PREFIX_TO_PROVIDER: Record<string, string> = {
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  qwen: "Qwen",
  mistralai: "Mistral",
  meta: "Meta",
  cohere: "Cohere",
  "x-ai": "xAI",
  xai: "xAI",
};

/** OpenRouter slugs that only accept the Stealth provider (not DeepInfra / vendor pins). */
export const OPENROUTER_STEALTH_MODEL_SLUGS: readonly string[] = ["openrouter/owl-alpha"];

export function isOpenRouterStealthModel(modelSlug: string): boolean {
  const s = (modelSlug ?? "").trim().toLowerCase();
  return OPENROUTER_STEALTH_MODEL_SLUGS.some((m) => m.toLowerCase() === s);
}

function deriveProviderFromModelSlug(slug: string): string | null {
  const prefix = slug.split("/")[0]?.toLowerCase() ?? "";
  return SLUG_PREFIX_TO_PROVIDER[prefix] ?? null;
}

function parseCsvList(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveProviderStrategy(): ProviderStrategy {
  const raw =
    effectiveHarnessEnvRaw("AGENT_PROVIDER_STRATEGY")?.trim().toLowerCase() ??
    HARNESS_ENV_DEFAULTS["AGENT_PROVIDER_STRATEGY"]?.trim().toLowerCase() ??
    "price";
  switch (raw) {
    case "price":
    case "cache_first":
    case "openrouter_default":
    case "throughput":
    case "latency":
      return raw;
    case "adaptive":
      return "adaptive";
    default:
      return "price";
  }
}

function resolveSortAxis(strategy: ProviderStrategy): ProviderSortAxis {
  const override = effectiveHarnessEnvRaw("AGENT_PROVIDER_SORT")?.trim().toLowerCase();
  if (override === "throughput" || override === "latency" || override === "price") {
    return override;
  }
  if (strategy === "throughput") return "throughput";
  if (strategy === "latency") return "latency";
  return "price";
}

function resolveAllowlist(isFastModel: boolean): string[] {
  if (isFastModel) {
    const fast = parseCsvList(effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER_FAST"));
    if (fast.length > 0) return fast;
  }
  return parseCsvList(effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER"));
}

function resolveStaticIgnores(): string[] {
  return parseCsvList(effectiveHarnessEnvRaw("AGENT_PROVIDER_IGNORE"));
}

function resolveMaxPrice(): ProviderRouting["max_price"] | undefined {
  const promptRaw = effectiveHarnessEnvRaw("AGENT_PROVIDER_MAX_PRICE_PROMPT")?.trim();
  const completionRaw = effectiveHarnessEnvRaw("AGENT_PROVIDER_MAX_PRICE_COMPLETION")?.trim();
  const prompt = promptRaw ? Number(promptRaw) : NaN;
  const completion = completionRaw ? Number(completionRaw) : NaN;
  const out: ProviderRouting["max_price"] = {};
  if (Number.isFinite(prompt) && prompt > 0) out.prompt = prompt;
  if (Number.isFinite(completion) && completion > 0) out.completion = completion;
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeIgnores(routeState?: ProviderRouteState): string[] | undefined {
  const merged = new Set<string>([...resolveStaticIgnores(), ...(routeState?.snapshot().ignore ?? [])]);
  if (merged.size === 0) return undefined;
  return [...merged];
}

function buildCacheFirstRouting(modelSlug: string, isFastModel: boolean): ProviderRouting | null {
  const allowFallbacks =
    effectiveHarnessEnvRaw("AGENT_PROVIDER_ALLOW_FALLBACKS")?.trim() !== "0";

  if (isOpenRouterStealthModel(modelSlug)) {
    return { order: ["Stealth"], allow_fallbacks: allowFallbacks };
  }

  if (isFastModel) {
    const fastExplicit = effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER_FAST")?.trim();
    if (fastExplicit && fastExplicit.length > 0) {
      const order = parseCsvList(fastExplicit);
      if (order.length > 0) return { order, allow_fallbacks: allowFallbacks };
    }
  }

  const explicit = effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER")?.trim();
  if (explicit && explicit.length > 0) {
    const order = parseCsvList(explicit);
    if (order.length > 0) return { order, allow_fallbacks: allowFallbacks };
  }

  const auto = effectiveHarnessEnvRaw("AGENT_PROVIDER_ROUTE_AUTO")?.trim();
  if (auto === "0") return null;

  const derived = deriveProviderFromModelSlug(modelSlug);
  if (!derived) return null;
  return { order: [derived], allow_fallbacks: allowFallbacks };
}

function buildDynamicRouting(
  modelSlug: string,
  isFastModel: boolean,
  strategy: ProviderStrategy,
  routeState?: ProviderRouteState
): ProviderRouting | null {
  if (isOpenRouterStealthModel(modelSlug)) {
    return { order: ["Stealth"], allow_fallbacks: true };
  }

  const sort = resolveSortAxis(strategy);
  const only = resolveAllowlist(isFastModel);
  const ignore = mergeIgnores(routeState);
  const max_price = resolveMaxPrice();

  const routing: ProviderRouting = {
    sort,
    allow_fallbacks: true,
  };
  if (only.length > 0) routing.only = only;
  if (ignore && ignore.length > 0) routing.ignore = ignore;
  if (max_price) routing.max_price = max_price;
  return routing;
}

/**
 * Resolve OpenRouter `provider` preferences for a chat completion.
 * Returns null for `openrouter_default` or non-OpenRouter bases (caller should omit field).
 */
export function resolveProviderRouting(ctx: ProviderRoutingContext): ProviderRouting | null {
  const strategy = resolveProviderStrategy();
  if (strategy === "openrouter_default") return null;
  if (strategy === "cache_first") {
    return buildCacheFirstRouting(ctx.modelSlug, ctx.isFastModel ?? false);
  }
  return buildDynamicRouting(
    ctx.modelSlug,
    ctx.isFastModel ?? false,
    strategy,
    ctx.routeState
  );
}

/**
 * @deprecated Prefer {@link resolveProviderRouting} — kept for existing call sites.
 */
export function buildProviderRouting(modelSlug: string, isFastModel = false): ProviderRouting | null {
  return resolveProviderRouting({ modelSlug, isFastModel });
}

export type OpenRouterChatRequestExtras = {
  provider?: ProviderRouting;
  session_id?: string;
  user?: string;
};

/**
 * Merge provider routing + session stickiness (with optional epoch suffix) for OpenRouter chat calls.
 */
export function buildOpenRouterChatRequestExtras(opts: {
  baseURL: string;
  modelSlug: string;
  isFastModel?: boolean;
  routeState?: ProviderRouteState;
  sessionId?: string | null;
  retryAttempt?: number;
}): OpenRouterChatRequestExtras {
  if (!supportsOpenRouterRequestExtras(opts.baseURL)) return {};

  const provider = resolveProviderRouting({
    modelSlug: opts.modelSlug,
    isFastModel: opts.isFastModel,
    routeState: opts.routeState,
    retryAttempt: opts.retryAttempt,
  });

  const sessionExtras = buildOpenRouterSessionExtras(opts.baseURL, opts.sessionId);
  if (sessionExtras.session_id && opts.routeState) {
    const id = opts.routeState.resolveSessionId(sessionExtras.session_id);
    return {
      ...(provider ? { provider } : {}),
      session_id: id,
      user: id,
    };
  }

  return {
    ...(provider ? { provider } : {}),
    ...sessionExtras,
  };
}

export function sessionEpochBumpOn429Enabled(): boolean {
  const raw = effectiveHarnessEnvRaw("AGENT_PROVIDER_SESSION_EPOCH_ON_429")?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

const DEFAULT_BASE_URL = DEFAULT_AGENT_API_BASE_URL;
const DEFAULT_MODEL = DEFAULT_AGENT_MODEL_SLUG;

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  keySource:
    | "AGENT_API_KEY"
    | "OPENROUTER_API_KEY"
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "XAI_API_KEY"
    | "VIREON_MANAGED";
}

export interface ProviderConfigOverrides {
  baseURL?: string;
  model?: string;
  keySource?: ProviderConfig["keySource"];
}

export interface VisionProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

function firstNonEmpty(
  keys: Array<ProviderConfig["keySource"]>
): { key: ProviderConfig["keySource"]; value: string } | null {
  ensureLocalProviderApiKeyInProcess();
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

export function resolveProviderConfig(overrides?: ProviderConfigOverrides): ProviderConfig {
  const order: Array<ProviderConfig["keySource"]> = overrides?.keySource
    ? [overrides.keySource, "AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"]
    : ["AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"];
  const picked = firstNonEmpty(order);
  if (!picked) {
    throw new Error(
      "No API key found. Set AGENT_API_KEY (preferred) or one of OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY."
    );
  }
  const baseURL = (overrides?.baseURL ?? process.env["AGENT_API_BASE_URL"]?.trim()) || DEFAULT_BASE_URL;
  const model = (overrides?.model ?? process.env["AGENT_MODEL"]?.trim()) || DEFAULT_MODEL;
  return {
    apiKey: picked.value,
    baseURL,
    model,
    keySource: picked.key,
  };
}

/**
 * Vision sidecar config — never silently inherit the primary chat model.
 * Uses effectiveHarnessEnvRaw (env → prefs → product defaults) so local AGENT_MODEL
 * does not override AGENT_VISION_MODEL when vision keys are unset in .env.
 */
export function resolveVisionProviderConfig(): VisionProviderConfig {
  const base = resolveProviderConfig();
  const defaultModel = HARNESS_ENV_DEFAULTS["AGENT_VISION_MODEL"]?.trim() ?? "";
  const defaultBase =
    HARNESS_ENV_DEFAULTS["AGENT_VISION_BASE_URL"]?.trim() || DEFAULT_BASE_URL;
  return {
    apiKey: effectiveHarnessEnvRaw("AGENT_VISION_API_KEY")?.trim() || base.apiKey,
    baseURL: effectiveHarnessEnvRaw("AGENT_VISION_BASE_URL")?.trim() || defaultBase,
    model: effectiveHarnessEnvRaw("AGENT_VISION_MODEL")?.trim() || defaultModel,
  };
}

/** Vision config with managed-inference routing when entitled (unless AGENT_VISION_API_KEY is set). */
export async function resolveVisionProviderConfigAsync(
  prefs?: RuntimePreferences | null
): Promise<VisionProviderConfig> {
  const sync = resolveVisionProviderConfig();
  if (effectiveHarnessEnvRaw("AGENT_VISION_API_KEY")?.trim()) {
    return sync;
  }
  const creds = await resolveManagedOpenRouterCredentials(prefs);
  if (creds.route === "managed") {
    return {
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      model: sync.model,
    };
  }
  return sync;
}
