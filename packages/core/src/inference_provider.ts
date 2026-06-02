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
import { ensureManagedInferenceSession } from "./inference_session.js";

export type InferenceMode = "byok" | "managed" | "auto";
export type OpenRouterRoute = "managed" | "byok";

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

function parseInferenceBudgetExceeded(err: unknown): string | null {
  if (!(err instanceof OpenAI.APIError) || err.status !== 402) return null;
  const raw =
    typeof err.error === "object" && err.error !== null
      ? JSON.stringify(err.error)
      : String(err.error ?? err.message);
  if (!/inference_budget_exceeded|credit limit reached/i.test(raw)) {
    return formatInferenceBudgetExceededMessage();
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

/** Augment provider errors (402 budget) with account top-up guidance. */
export function describeProviderError(err: unknown): string {
  const budget = parseInferenceBudgetExceeded(err);
  if (budget) return budget;
  if (err instanceof OpenAI.APIError) {
    const body =
      typeof err.error === "object" && err.error !== null
        ? JSON.stringify(err.error)
        : String(err.error ?? err.message);
    return `HTTP ${err.status} from ${err.name}: ${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function hasLocalProviderApiKey(): boolean {
  const keys = [
    "AGENT_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
  ] as const;
  return keys.some((k) => Boolean(process.env[k]?.trim()));
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

  const managed = await shouldRouteOpenRouterViaManaged(prefs);
  if (mode === "managed" && !managed) {
    throw new Error(
      "AGENT_INFERENCE_MODE=managed requires pro.managed_inference on an active Pro (or higher) license."
    );
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
