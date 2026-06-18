import OpenAI from "openai";
import {
  DEFAULT_AGENT_API_BASE_URL,
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
import { formatKimchiProviderError } from "./kimchi_provider.js";
import { isKimchiApiBaseUrl } from "./kimchi_constants.js";
import { ensureLocalProviderApiKeyInProcess } from "./provider_api_key.js";
import {
  buildManagedRecoveryHarnessEnv,
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

const INFERENCE_SESSION_RETRIES = 3;
const INFERENCE_SESSION_RETRY_BASE_MS = 800;
const INFERENCE_SESSION_RETRY_MAX_MS = 10_000;

function isRetryableSessionError(err: unknown): boolean {
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return /econnreset|econnrefused|etimedout|socket|network|fetch failed|und_err/i.test(msg);
  }
  return false;
}

function parseSessionRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return Math.round(secs * 1000);
  const ts = Date.parse(header);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, ts - Date.now());
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

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

/**
 * Effective managed upstream for one request. When preference is `auto`, pick from
 * model id shape so OpenRouter slugs (e.g. `nex-agi/...:free`) do not hit Bedrock.
 */
export function resolveManagedProviderForRequest(
  prefs?: RuntimePreferences | null,
  modelSlug?: string | null
): ManagedProviderPreference {
  const pref = resolveManagedProviderPreference(prefs);
  if (pref !== "auto") return pref;
  const slug = modelSlug?.trim();
  if (slug) return modelNativeManagedProvider(slug);
  return "auto";
}

/** Headers attached to chat/embedding calls through the Vireon inference proxy. */
export function buildManagedInferenceClientHeaders(
  prefs?: RuntimePreferences | null,
  modelSlug?: string | null
): Record<string, string> {
  return {
    [MANAGED_INFERENCE_PROVIDER_HEADER]: resolveManagedProviderForRequest(prefs, modelSlug),
  };
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
  return /missing auth|auth header|unauthorized|no authorization|invalid token|invalid.*session|\bexpired\b|jwt.*expired|session.*expired|token.*expired/i.test(
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

/** Stable string body for OpenAI SDK / proxy errors (status may be undefined). */
export function extractProviderErrorBody(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (typeof err.error === "object" && err.error !== null) return JSON.stringify(err.error);
    return String(err.error ?? err.message ?? "");
  }
  return err instanceof Error ? err.message : String(err);
}

/** True for transient upstream/server failures worth retrying (incl. undefined HTTP status). */
export function isInferenceServerError(err: unknown): boolean {
  if (err instanceof OpenAI.InternalServerError) return true;
  if (err instanceof OpenAI.APIError && err.status != null && err.status >= 500) return true;
  const body = extractProviderErrorBody(err).toLowerCase();
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const combined = `${body} ${msg}`;
  if (/internal_server_error|server_error|"type"\s*:\s*"server_error"/.test(combined)) return true;
  if (/\b500\b|\b502\b|\b503\b|\b504\b|bad gateway|service unavailable|gateway timeout/.test(combined))
    return true;
  return false;
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
    const body = extractProviderErrorBody(err);
    if (err.status === 400 && /no body|status code \(no body\)/i.test(body)) {
      return (
        "HTTP 400 from inference provider (empty upstream body). " +
        "This is a model/API rejection — not Azure, shell, or a local tool failure. " +
        "Try Settings → switch model (e.g. DeepSeek V4), add AGENT_API_KEY for OpenRouter BYOK, or send again."
      );
    }
    if (err.status == null && isInferenceServerError(err)) {
      return `HTTP 500 from inference provider (transient): ${body || err.message}`;
    }
    return `HTTP ${err.status ?? "unknown"} from ${err.name}: ${body}`;
  }
  if (isInferenceServerError(err)) {
    return `HTTP 500 from inference provider (transient): ${extractProviderErrorBody(err)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function hasLocalProviderApiKey(): boolean {
  return Boolean(ensureLocalProviderApiKeyInProcess());
}

/**
 * Optional prefs patch when the user explicitly chose BYOK mode for a model slug.
 * Managed inference routes all catalog shapes (Bedrock / OpenRouter / Kimchi) — no
 * auto-switch away from managed when picking openrouter/* or :free slugs.
 */
export function buildByokRoutingPatchForModel(
  model: string,
  prefs?: RuntimePreferences | null
): Partial<RuntimePreferences> | null {
  const slug = model.trim();
  if (!slug) return null;
  const mode = resolveInferenceMode(prefs);
  if (mode !== "byok") return null;
  return {
    harness: { env: { AGENT_MODEL: slug } },
    provider: { model: slug },
  };
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
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= INFERENCE_SESSION_RETRIES) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${license}`,
          Accept: "application/json",
        },
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= INFERENCE_SESSION_RETRIES) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Inference session failed (${res.status})`);
        }
        const retryMs = parseSessionRetryAfterMs(res);
        const exp = Math.min(10, attempt);
        const base = Math.min(
          INFERENCE_SESSION_RETRY_MAX_MS,
          Math.round(INFERENCE_SESSION_RETRY_BASE_MS * Math.pow(2, exp))
        );
        const jitter = Math.round(Math.random() * base * 0.3);
        const delay = Math.max(200, Math.min(INFERENCE_SESSION_RETRY_MAX_MS, retryMs ?? base + jitter));
        console.log(`[inference_session] retry ${attempt + 1}/${INFERENCE_SESSION_RETRIES} after ${delay}ms (status ${res.status})`);
        await sleepWithAbort(delay);
        attempt += 1;
        continue;
      }

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
    } catch (err) {
      lastErr = err;
      if (!isRetryableSessionError(err) || attempt >= INFERENCE_SESSION_RETRIES) {
        throw err;
      }
      const exp = Math.min(10, attempt);
      const base = Math.min(
        INFERENCE_SESSION_RETRY_MAX_MS,
        Math.round(INFERENCE_SESSION_RETRY_BASE_MS * Math.pow(2, exp))
      );
      const jitter = Math.round(Math.random() * base * 0.3);
      const delay = Math.max(200, base + jitter);
      console.log(`[inference_session] network retry ${attempt + 1}/${INFERENCE_SESSION_RETRIES} after ${delay}ms`);
      await sleepWithAbort(delay);
      attempt += 1;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "inference session retry exhausted"));
}

let inferenceSessionFetchInFlight: Promise<InferenceSessionResult> | null = null;

/** Coalesce concurrent session mints (send + background keeper + multi-tool sidecars). */
export function fetchInferenceSessionDeduped(
  prefs?: RuntimePreferences | null
): Promise<InferenceSessionResult> {
  if (!inferenceSessionFetchInFlight) {
    inferenceSessionFetchInFlight = fetchInferenceSession(prefs).finally(() => {
      inferenceSessionFetchInFlight = null;
    });
  }
  return inferenceSessionFetchInFlight;
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
    return resolveProviderConfig(overrides);
  }

  if (managed) {
    const creds = await resolveManagedOpenRouterCredentials(prefs);
    const model =
      (overrides?.model ?? prefs?.provider?.model ?? process.env["AGENT_MODEL"]?.trim()) ||
      DEFAULT_AGENT_MODEL_SLUG;
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
  catalogRegions?: string[];
  curatedBedrock?: {
    source: string;
    sourceUrl: string;
    providerId: string;
    syncedAt: string;
  };
  models: ManagedInferenceModel[];
};

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

function narrowManagedModelForProvider(
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

function catalogRowOwnsModelId(row: ManagedInferenceModel, modelId: string): boolean {
  const target = modelId.trim();
  if (!target) return false;
  if (row.id.trim() === target) return true;
  return (row.providers ?? []).some((p) => p.id.trim() === target);
}

const BEDROCK_GEO_STRIP = /^(us|eu|global|apac|au|jp)\./i;

function bedrockIdWithoutGeoPrefix(modelId: string): string | null {
  const m = modelId.trim();
  if (!m || m.includes("/")) return null;
  if (!BEDROCK_GEO_STRIP.test(m)) return null;
  return m.replace(BEDROCK_GEO_STRIP, "");
}

function catalogRowMatchesBedrockStem(row: ManagedInferenceModel, stem: string): boolean {
  const ids = [row.id, ...(row.providers ?? []).map((p) => p.id)];
  return ids.some((id) => {
    const bare = id.trim();
    if (!bare) return false;
    if (bare === stem) return true;
    const stripped = bedrockIdWithoutGeoPrefix(bare);
    return stripped === stem;
  });
}

/**
 * Map a saved model id to the catalog row id shown for a managed upstream filter.
 * Regional Bedrock profiles (e.g. global.anthropic.claude-sonnet-4-6) are absent from
 * openrouter-only views — without remapping, pickers show the wrong selection.
 */
export function resolveManagedModelForProviderPreference(
  model: string,
  catalog: ManagedInferenceModel[],
  preference: ManagedProviderPreference | string | null | undefined
): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  const pref =
    typeof preference === "string"
      ? parseManagedProviderPreference(preference)
      : (preference ?? "auto");
  const filtered = filterManagedInferenceCatalog(catalog, pref);
  if (filtered.some((m) => m.id === trimmed)) return trimmed;
  for (const row of catalog) {
    if (!catalogRowOwnsModelId(row, trimmed)) continue;
    if (pref === "auto") return row.id;
    const narrowed = narrowManagedModelForProvider(row, pref);
    if (narrowed) return narrowed.id;
  }
  const stem = bedrockIdWithoutGeoPrefix(trimmed) ?? trimmed;
  if (pref !== "auto") {
    for (const row of catalog) {
      if (!catalogRowMatchesBedrockStem(row, stem)) continue;
      const narrowed = narrowManagedModelForProvider(row, pref);
      if (narrowed) return narrowed.id;
    }
  }
  return trimmed;
}

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
    catalogRegions?: string[];
    curatedBedrock?: {
      source?: string;
      sourceUrl?: string;
      providerId?: string;
      syncedAt?: string;
    };
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
    ...(Array.isArray(body.catalogRegions) &&
      body.catalogRegions.length > 0 && {
        catalogRegions: body.catalogRegions.map((r) => String(r).trim()).filter(Boolean),
      }),
    ...(body.curatedBedrock &&
      typeof body.curatedBedrock === "object" && {
        curatedBedrock: {
          source: String(body.curatedBedrock.source ?? "models.dev"),
          sourceUrl: String(body.curatedBedrock.sourceUrl ?? "https://models.dev/api.json"),
          providerId: String(body.curatedBedrock.providerId ?? "amazon-bedrock"),
          syncedAt: String(body.curatedBedrock.syncedAt ?? ""),
        },
      }),
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
  if (mode === "byok") return false;
  const model =
    prefs.provider?.model?.trim() ||
    resolveHarnessEnvRaw("AGENT_MODEL", prefs)?.trim() ||
    DEFAULT_AGENT_MODEL_SLUG;
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
