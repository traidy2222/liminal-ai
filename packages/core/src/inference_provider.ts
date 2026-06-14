import OpenAI from "openai";
import {
  DEFAULT_AGENT_MODEL_SLUG,
  HARNESS_ENV_DEFAULTS,
} from "./harness_default_constants.js";
import {
  ENTITLEMENTS,
  hasEntitlement,
  loadResolvedEntitlements,
} from "./entitlements.js";
import { resolveLicenseTokenForHarness } from "./vireon_account.js";
import {
  effectiveHarnessEnvRaw,
  resolveHarnessEnvRaw,
} from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import {
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderConfigOverrides,
} from "./provider_config.js";
import {
  ensureManagedInferenceSession,
  isManagedInferenceBaseUrl,
} from "./inference_session.js";
import { formatKimchiProviderError, isKimchiApiBaseUrl } from "./kimchi_provider.js";
import { ensureLocalProviderApiKeyInProcess } from "./provider_api_key.js";
import {
  buildManagedRecoveryHarnessEnv,
  isModelIncompatibleWithManagedProxy,
  resolveModelForManagedInference,
} from "./managed_free_fallback.js";

export type InferenceMode = "byok" | "managed" | "auto";
export type OpenRouterRoute = "managed" | "byok";
export type ManagedProviderPreference = "auto" | "bedrock" | "openrouter" | "kimchi";

/** Request header read by the Vireon inference proxy for upstream routing. */
export const MANAGED_INFERENCE_PROVIDER_HEADER = "x-vireon-managed-provider";

export type ManagedOpenRouterCredentials = {
  route: OpenRouterRoute;
  apiKey: string;
  baseURL: string;
};

const DEFAULT_INFERENCE_BASE_URL =
  HARNESS_ENV_DEFAULTS["AGENT_INFERENCE_BASE_URL"]?.trim() ||
  "https://api.vireondynamics.com/v1/inference";

const DEFAULT_INFERENCE_SESSION_URL =
  HARNESS_ENV_DEFAULTS["AGENT_INFERENCE_SESSION_URL"]?.trim() ||
  "https://www.vireondynamics.com/api/inference/session";

export interface InferenceSessionResult {
  token: string;
  expiresAt: string;
  baseURL: string;
}

function parseInferenceMode(raw: string | undefined): InferenceMode {
  const v = raw?.trim().toLowerCase();
  if (v === "managed" || v === "byok" || v === "auto") return v;
  return "auto";
}

export function resolveInferenceMode(prefs?: RuntimePreferences | null): InferenceMode {
  const fromPrefs = prefs?.provider?.inferenceMode;
  if (fromPrefs) return fromPrefs;
  return parseInferenceMode(effectiveHarnessEnvRaw("AGENT_INFERENCE_MODE"));
}

function parseManagedProviderPreference(raw: string | undefined): ManagedProviderPreference {
  const v = raw?.trim().toLowerCase();
  if (v === "bedrock" || v === "openrouter" || v === "kimchi") return v;
  return "auto";
}

/** Upstream preference for Vireon managed inference (Bedrock / OpenRouter / Kimchi). */
export function resolveManagedProviderPreference(prefs?: RuntimePreferences | null): ManagedProviderPreference {
  const fromPrefs = prefs?.harness?.env?.["AGENT_MANAGED_PROVIDER"]?.trim();
  if (fromPrefs) return parseManagedProviderPreference(fromPrefs);
  return parseManagedProviderPreference(resolveHarnessEnvRaw("AGENT_MANAGED_PROVIDER", prefs ?? null));
}

/** Headers attached to chat/embedding calls through the Vireon inference proxy. */
export function buildManagedInferenceClientHeaders(
  prefs?: RuntimePreferences | null
): Record<string, string> {
  return { [MANAGED_INFERENCE_PROVIDER_HEADER]: resolveManagedProviderPreference(prefs) };
}

function truthyEnv(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** When true, `auto` uses managed inference for entitled users even if a local API key exists. */
export function inferencePreferManaged(prefs?: RuntimePreferences | null): boolean {
  return truthyEnv(resolveHarnessEnvRaw("AGENT_INFERENCE_PREFER_MANAGED", prefs ?? null));
}

export function defaultVireonSiteOriginForInference(): string {
  const raw =
    effectiveHarnessEnvRaw("AGENT_VIREON_SITE_URL")?.trim() ||
    process.env["VIREON_SITE_URL"]?.trim() ||
    "https://www.vireondynamics.com";
  return raw.replace(/\/$/, "");
}

export function inferenceAccountUrl(): string {
  return `${defaultVireonSiteOriginForInference()}/account/inference`;
}

export function inferenceTopUpHint(): string {
  return `Add inference credits: ${inferenceAccountUrl()}`;
}

/** User-facing message when the Vireon proxy returns HTTP 402 (budget exceeded). */
export function formatInferenceBudgetExceededMessage(detail?: string): string {
  const base =
    detail?.trim() ||
    "Managed inference credit limit reached for this billing period.";
  return `${base} ${inferenceTopUpHint()}`;
}

export function isInferenceBudgetExceededError(err: unknown): boolean {
  return parseInferenceBudgetExceeded(err) !== null;
}

/** Managed proxy / session errors that should trigger BYOK free-model fallback. */
export function isManagedInferenceAuthError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError) || err.status !== 401) return false;
  const raw =
    typeof err.error === "object" && err.error !== null
      ? JSON.stringify(err.error)
      : String(err.error ?? err.message);
  const msg = raw.toLowerCase();
  return /missing auth|auth header|unauthorized|no authorization|invalid token|invalid.*session/i.test(
    msg
  );
}

function parseInferenceBudgetExceeded(err: unknown): string | null {
  if (!(err instanceof OpenAI.APIError)) return null;
  if (err.status !== 402 && err.status !== 403) return null;
  const raw =
    typeof err.error === "object" && err.error !== null
      ? JSON.stringify(err.error)
      : String(err.error ?? err.message);
  if (
    !/inference_budget_exceeded|credit limit reached|key limit exceeded|limit exceeded \(monthly/i.test(
      raw
    )
  ) {
    if (err.status === 402) return formatInferenceBudgetExceededMessage();
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string };
    const msg =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined;
    return formatInferenceBudgetExceededMessage(msg);
  } catch {
    return formatInferenceBudgetExceededMessage();
  }
}

export interface DescribeProviderErrorOpts {
  baseURL?: string;
  retriesExhausted?: boolean;
}

/** Augment provider errors (402 budget) with account top-up guidance. */
export function describeProviderError(
  err: unknown,
  opts?: DescribeProviderErrorOpts
): string {
  const budget = parseInferenceBudgetExceeded(err);
  if (budget) return budget;
  if (isKimchiApiBaseUrl(opts?.baseURL)) {
    const kimchi = formatKimchiProviderError(err, { retriesExhausted: opts?.retriesExhausted });
    if (kimchi) return kimchi;
  }
  if (err instanceof OpenAI.APIError) {
    const body =
      typeof err.error === "object" && err.error !== null
        ? JSON.stringify(err.error)
        : String(err.error ?? err.message);
    if (err.status === 400 && /no body|status code \(no body\)/i.test(body)) {
      return (
        "HTTP 400 from inference provider (empty upstream body). " +
        "This is a model/API rejection — not Azure, shell, or a local tool failure. " +
        "Try Settings → switch model (e.g. DeepSeek V4), add AGENT_API_KEY for OpenRouter BYOK, or send again."
      );
    }
    return `HTTP ${err.status} from ${err.name}: ${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function hasLocalProviderApiKey(): boolean {
  return Boolean(ensureLocalProviderApiKeyInProcess());
}

export function managedInferenceBaseUrl(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_INFERENCE_BASE_URL")?.trim() || DEFAULT_INFERENCE_BASE_URL
  ).replace(/\/$/, "");
}

function inferenceBaseUrl(): string {
  return managedInferenceBaseUrl();
}

function inferenceSessionUrl(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_INFERENCE_SESSION_URL")?.trim() || DEFAULT_INFERENCE_SESSION_URL
  );
}

async function resolveLicenseTokenForSession(): Promise<string | null> {
  return resolveLicenseTokenForHarness();
}

export async function fetchInferenceSession(
  prefs?: RuntimePreferences | null
): Promise<InferenceSessionResult> {
  const pinned = effectiveHarnessEnvRaw("AGENT_INFERENCE_SESSION_TOKEN")?.trim();
  if (pinned) {
    const exp = new Date(Date.now() + 14 * 60_000).toISOString();
    return { token: pinned, expiresAt: exp, baseURL: inferenceBaseUrl() };
  }

  const license = await resolveLicenseTokenForSession();
  if (!license) {
    throw new Error(
      "Sign in to Vireon first (liminal login, or Settings → Sign in to Vireon), or set AGENT_INFERENCE_SESSION_TOKEN for headless CI."
    );
  }

  const url = inferenceSessionUrl();
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${license}`,
      Accept: "application/json",
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    expiresAt?: string;
    baseURL?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `Inference session failed (${res.status})`);
  }
  if (!body.token?.trim()) {
    throw new Error("Inference session response missing token");
  }
  return {
    token: body.token.trim(),
    expiresAt: body.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
    baseURL: (body.baseURL ?? inferenceBaseUrl()).replace(/\/$/, ""),
  };
}

/** True when OpenRouter sidecar calls should route through the Vireon inference proxy. */
export async function shouldRouteOpenRouterViaManaged(
  prefs?: RuntimePreferences | null
): Promise<boolean> {
  const mode = resolveInferenceMode(prefs);
  if (mode === "byok") return false;
  const pinnedBase = prefs?.provider?.baseURL?.trim();
  if (
    mode !== "managed" &&
    pinnedBase &&
    !isManagedInferenceBaseUrl(pinnedBase)
  ) {
    return false;
  }
  const entitlements = await loadResolvedEntitlements();
  const entitled = hasEntitlement(entitlements, ENTITLEMENTS.PRO_MANAGED_INFERENCE);
  if (!entitled) return false;
  if (mode === "managed") return true;
  return !hasLocalProviderApiKey() || inferencePreferManaged(prefs);
}

/**
 * Single gate for managed vs BYOK OpenRouter routing (chat sidecars, embeddings, vision, audio).
 * When `route === "managed"`, returns session JWT + inference proxy base URL.
 */
export async function resolveManagedOpenRouterCredentials(
  prefs?: RuntimePreferences | null,
  opts?: { refreshSession?: boolean }
): Promise<ManagedOpenRouterCredentials> {
  const managed = await shouldRouteOpenRouterViaManaged(prefs);
  if (managed) {
    if (opts?.refreshSession) {
      const session = await fetchInferenceSession(prefs);
      return {
        route: "managed",
        apiKey: session.token,
        baseURL: session.baseURL.replace(/\/$/, ""),
      };
    }
    const session = await ensureManagedInferenceSession(prefs, inferenceBaseUrl());
    if (!session) {
      throw new Error("Managed inference session unavailable — sign in to Vireon first.");
    }
    return {
      route: "managed",
      apiKey: session.apiKey,
      baseURL: session.baseURL.replace(/\/$/, ""),
    };
  }
  const byok = resolveProviderConfig();
  return {
    route: "byok",
    apiKey: byok.apiKey,
    baseURL: byok.baseURL.replace(/\/$/, ""),
  };
}

/**
 * Resolve chat provider config, optionally routing through Vireon managed inference.
 */
export async function resolveProviderConfigWithInference(
  overrides?: ProviderConfigOverrides,
  prefs?: RuntimePreferences | null
): Promise<ProviderConfig> {
  const mode = resolveInferenceMode(prefs);
  if (mode === "byok") {
    return resolveProviderConfig(overrides);
  }

  const requestedBase =
    overrides?.baseURL?.trim() || prefs?.provider?.baseURL?.trim();
  if (
    mode !== "managed" &&
    requestedBase &&
    !isManagedInferenceBaseUrl(requestedBase)
  ) {
    return resolveProviderConfig({ ...overrides, baseURL: requestedBase });
  }

  const managed = await shouldRouteOpenRouterViaManaged(prefs);
  if (mode === "managed" && !managed) {
    throw new Error(
      "AGENT_INFERENCE_MODE=managed requires pro.managed_inference on an active Pro (or higher) license."
    );
  }

  if (managed) {
    const creds = await resolveManagedOpenRouterCredentials(prefs);
    const rawModel =
      (overrides?.model ?? prefs?.provider?.model ?? process.env["AGENT_MODEL"]?.trim()) ||
      DEFAULT_AGENT_MODEL_SLUG;
    const model = isModelIncompatibleWithManagedProxy(rawModel)
      ? resolveModelForManagedInference(rawModel, prefs)
      : rawModel;
    return {
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      model,
      keySource: "VIREON_MANAGED",
    };
  }

  return resolveProviderConfig(overrides);
}

export type InferenceUsageStatus = {
  configured: boolean;
  entitled: boolean;
  reason: string;
  remainingUsd: number | null;
  capUsd: number | null;
  usedUsd: number | null;
  periodEnd: string | null;
};

export type ManagedInferenceProviderRef = {
  provider: ManagedProviderPreference;
  id: string;
};

export type ManagedInferenceModel = {
  id: string;
  label: string;
  family: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  /** When set, model is reachable on multiple managed upstreams (catalog merge). */
  providers?: ManagedInferenceProviderRef[];
};

export type ManagedInferenceModelsResult = {
  upstream: string;
  region: string;
  models: ManagedInferenceModel[];
};

/** Bedrock catalog for managed-inference model pickers (license Bearer). */
export async function fetchManagedInferenceModels(opts?: {
  refresh?: boolean;
}): Promise<ManagedInferenceModelsResult | null> {
  const license = await resolveLicenseTokenForHarness();
  if (!license) return null;
  const base = defaultVireonSiteOriginForInference();
  const qs = opts?.refresh ? "?refresh=1" : "";
  const res = await fetch(`${base}/api/inference/models${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${license}`, Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    upstream?: string;
    region?: string;
    models?: Array<{
      id?: string;
      label?: string;
      family?: string;
      contextLength?: number;
      maxCompletionTokens?: number;
      providers?: Array<{ provider?: string; id?: string }>;
    }>;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const models: ManagedInferenceModel[] = Array.isArray(body.models)
    ? body.models
        .map((m) => {
          const providers = Array.isArray(m.providers)
            ? m.providers
                .map((p) => ({
                  provider: parseManagedProviderPreference(
                    typeof p.provider === "string" ? p.provider : undefined
                  ),
                  id: String(p.id ?? "").trim(),
                }))
                .filter((p) => p.id.length > 0 && p.provider !== "auto")
            : undefined;
          return {
            id: String(m.id ?? "").trim(),
            label: String(m.label ?? m.id ?? "").trim(),
            family: String(m.family ?? "other").trim(),
            ...(typeof m.contextLength === "number" &&
              m.contextLength > 0 && { contextLength: m.contextLength }),
            ...(typeof m.maxCompletionTokens === "number" &&
              m.maxCompletionTokens > 0 && { maxCompletionTokens: m.maxCompletionTokens }),
            ...(providers && providers.length > 0 && { providers }),
          };
        })
        .filter((m) => m.id.length > 0)
    : [];
  return {
    upstream: body.upstream ?? "bedrock",
    region: body.region ?? "us-east-1",
    models,
  };
}

/** Poll Vireon control plane for wallet / entitlement (license Bearer). */
export async function fetchInferenceUsageStatus(
  prefs?: RuntimePreferences | null
): Promise<InferenceUsageStatus | null> {
  const license = await resolveLicenseTokenForHarness();
  if (!license) return null;
  const base = defaultVireonSiteOriginForInference();
  const res = await fetch(`${base}/api/inference/status`, {
    method: "GET",
    headers: { Authorization: `Bearer ${license}`, Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    configured?: boolean;
    entitled?: boolean;
    reason?: string;
    remainingUsd?: number | null;
    capUsd?: number | null;
    usedUsd?: number | null;
    periodEnd?: string | null;
  };
  if (!res.ok) {
    return {
      configured: Boolean(body.configured),
      entitled: false,
      reason: body.reason ?? `HTTP ${res.status}`,
      remainingUsd: null,
      capUsd: null,
      usedUsd: null,
      periodEnd: null,
    };
  }
  return {
    configured: Boolean(body.configured),
    entitled: Boolean(body.entitled),
    reason: body.reason ?? "ok",
    remainingUsd: body.remainingUsd ?? null,
    capUsd: body.capUsd ?? null,
    usedUsd: body.usedUsd ?? null,
    periodEnd: body.periodEnd ?? null,
  };
}

/** Runtime prefs patch after Pro sign-in — route through included managed inference. */
export function proManagedInferencePrefsPatch(): Partial<RuntimePreferences> {
  return {
    provider: { inferenceMode: "managed" },
    harness: { env: { AGENT_INFERENCE_MODE: "managed", AGENT_INFERENCE_PREFER_MANAGED: "1" } },
  };
}

function prefsNeedManagedRecovery(prefs: RuntimePreferences): boolean {
  const mode = resolveInferenceMode(prefs);
  const model =
    prefs.provider?.model?.trim() ||
    resolveHarnessEnvRaw("AGENT_MODEL", prefs)?.trim() ||
    DEFAULT_AGENT_MODEL_SLUG;
  if (isModelIncompatibleWithManagedProxy(model)) {
    return mode === "managed" || (mode !== "byok" && inferencePreferManaged(prefs));
  }
  const pinnedBase = prefs.provider?.baseURL?.trim();
  if (
    mode === "managed" &&
    pinnedBase &&
    !isManagedInferenceBaseUrl(pinnedBase)
  ) {
    return true;
  }
  return false;
}

/**
 * When credits return after a free-model BYOK fallback, restore managed routing in prefs.
 * Safe to call on reconnect / sign-in — no-op when BYOK is intentional or wallet is empty.
 */
export async function recoverManagedInferencePreferences(
  prefs: RuntimePreferences | null
): Promise<{ recovered: boolean; prefs: RuntimePreferences | null }> {
  if (!prefs) return { recovered: false, prefs };
  if (!prefsNeedManagedRecovery(prefs)) return { recovered: false, prefs };

  const entitlements = await loadResolvedEntitlements();
  if (!hasEntitlement(entitlements, ENTITLEMENTS.PRO_MANAGED_INFERENCE)) {
    return { recovered: false, prefs };
  }

  const status = await fetchInferenceUsageStatus(prefs);
  if (!status?.entitled) return { recovered: false, prefs };
  if (status.remainingUsd != null && status.remainingUsd <= 0) {
    return { recovered: false, prefs };
  }

  const model = resolveModelForManagedInference(prefs.provider?.model, prefs);
  const { baseURL: _pinnedByokBase, ...providerSansBase } = prefs.provider ?? {};
  const recovered: RuntimePreferences = {
    ...prefs,
    updatedAt: Date.now(),
    provider: {
      ...providerSansBase,
      inferenceMode: "managed",
      model,
    },
    harness: {
      env: {
        ...prefs.harness?.env,
        ...buildManagedRecoveryHarnessEnv(prefs, model),
      },
    },
  };
  return { recovered: true, prefs: recovered };
}
