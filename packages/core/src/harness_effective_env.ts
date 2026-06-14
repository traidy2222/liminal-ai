import { AsyncLocalStorage } from "node:async_hooks";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import { HARNESS_SECRET_ENV_KEYS } from "./harness_env_inventory.js";
import { latencyModePatchForKey } from "./latency_mode.js";

const harnessEnvAsyncLocal = new AsyncLocalStorage<{ prefs: RuntimePreferences | null }>();

/** Model + API base are UI-managed via runtime prefs — not pinned by `.env` (keys stay in `.env` only). */
export const PROVIDER_ROUTING_ENV_KEYS = new Set(["AGENT_MODEL", "AGENT_API_BASE_URL"]);

/**
 * Run `fn` with async-local harness env context so `effectiveHarnessEnvRaw` resolves
 * prefs from the active AgentHarness during a `send()` / tool execution chain.
 */
export function runHarnessEffectiveEnvContext<T>(prefs: RuntimePreferences | null, fn: () => T): T {
  return harnessEnvAsyncLocal.run({ prefs }, fn);
}

/** Settings → Provider slice (model + base URL for the active backend). */
function providerSliceEnv(prefs: RuntimePreferences | null, key: string): string | undefined {
  if (!prefs?.provider) return undefined;
  if (key === "AGENT_MODEL") {
    const m = prefs.provider.model?.trim();
    if (m) return m;
  }
  if (key === "AGENT_API_BASE_URL") {
    const b = prefs.provider.baseURL?.trim();
    if (b) return b;
  }
  return undefined;
}

function runtimeSliceEnv(prefs: RuntimePreferences | null, key: string): string | undefined {
  if (!prefs?.runtime) return undefined;
  const r = prefs.runtime;
  if (key === "AGENT_UI_VERBOSITY" && r.uiVerbosity) return r.uiVerbosity;
  if (key === "AGENT_VAULT_AUTO_WRITE" && r.vaultAutoWriteMode) return r.vaultAutoWriteMode;
  if (key === "AGENT_APPROVAL_TIMEOUT_MS" && r.approvalTimeoutMs != null) {
    return String(r.approvalTimeoutMs);
  }
  if (key === "AGENT_RATE_LIMIT_MAX_RETRIES" && r.rateLimitMaxRetries != null) {
    return String(r.rateLimitMaxRetries);
  }
  if (key === "AGENT_TRANSIENT_5XX_MAX_RETRIES" && r.transient5xxMaxRetries != null) {
    return String(r.transient5xxMaxRetries);
  }
  if (key === "AGENT_RETRY_MAX_DELAY_MS" && r.retryMaxDelayMs != null) {
    return String(r.retryMaxDelayMs);
  }
  return undefined;
}

/**
 * Resolve one `AGENT_*` value.
 * Secrets: `process.env` only.
 * Model/base URL: runtime provider prefs → `.env` fallback → harness prefs → defaults.
 * Everything else: `process.env` → prefs → defaults.
 */
export function resolveHarnessEnvRaw(key: string, prefs: RuntimePreferences | null): string | undefined {
  if (HARNESS_SECRET_ENV_KEYS.has(key)) {
    return process.env[key]?.trim();
  }
  if (PROVIDER_ROUTING_ENV_KEYS.has(key)) {
    const fromProvider = providerSliceEnv(prefs, key);
    if (fromProvider !== undefined && fromProvider !== "") return fromProvider;
    const envRaw = process.env[key]?.trim();
    if (envRaw !== undefined && envRaw !== "") return envRaw;
    const fromHarness = prefs?.harness?.env?.[key]?.trim();
    if (fromHarness !== undefined && fromHarness !== "") return fromHarness;
    const d = HARNESS_ENV_DEFAULTS[key];
    return d !== undefined && d !== "" ? d : undefined;
  }
  const envFirst = process.env[key]?.trim();
  if (envFirst !== undefined && envFirst !== "") return envFirst;
  const fromProvider = providerSliceEnv(prefs, key);
  if (fromProvider !== undefined && fromProvider !== "") return fromProvider;
  const fromRuntime = runtimeSliceEnv(prefs, key);
  if (fromRuntime !== undefined && fromRuntime !== "") return fromRuntime;
  const fromHarness = prefs?.harness?.env?.[key]?.trim();
  if (fromHarness !== undefined && fromHarness !== "") return fromHarness;
  const latencyPatch = latencyModePatchForKey(key, prefs);
  if (latencyPatch !== undefined) return latencyPatch;
  const d = HARNESS_ENV_DEFAULTS[key];
  return d !== undefined && d !== "" ? d : undefined;
}

/** Same as {@link resolveHarnessEnvRaw} but uses async-local prefs from the active `send()` context. */
export function effectiveHarnessEnvRaw(key: string): string | undefined {
  const ctx = harnessEnvAsyncLocal.getStore();
  return resolveHarnessEnvRaw(key, ctx?.prefs ?? null);
}

export function effectiveHarnessEnvString(key: string, fallback: string): string {
  return effectiveHarnessEnvRaw(key) ?? fallback;
}

/** Where {@link resolveHarnessEnvRaw} took its winning value from (for Settings UI). */
export type HarnessEnvResolutionSource =
  | "environment"
  | "runtime_preferences"
  | "harness_preferences"
  | "product_default"
  | "unset";

/**
 * Effective value plus whether the real process environment currently sets this key
 * (non-empty). When `lockedByEnv` is true, the web Settings UI should not offer edits.
 */
export function harnessEnvResolutionMeta(
  key: string,
  prefs: RuntimePreferences | null
): { value: string | undefined; lockedByEnv: boolean; source: HarnessEnvResolutionSource } {
  if (HARNESS_SECRET_ENV_KEYS.has(key)) {
    return { value: undefined, lockedByEnv: true, source: "environment" };
  }
  if (PROVIDER_ROUTING_ENV_KEYS.has(key)) {
    const value = resolveHarnessEnvRaw(key, prefs);
    const fromProvider = providerSliceEnv(prefs, key);
    const source: HarnessEnvResolutionSource = fromProvider
      ? "runtime_preferences"
      : process.env[key]?.trim()
        ? "environment"
        : prefs?.harness?.env?.[key]?.trim()
          ? "harness_preferences"
          : value
            ? "product_default"
            : "unset";
    return { value, lockedByEnv: false, source };
  }
  const envRaw = process.env[key]?.trim();
  const lockedByEnv = !!(envRaw && envRaw.length > 0);
  if (envRaw !== undefined && envRaw !== "") {
    return { value: envRaw, lockedByEnv: true, source: "environment" };
  }
  const fromProvider = providerSliceEnv(prefs, key);
  if (fromProvider !== undefined && fromProvider !== "") {
    return { value: fromProvider, lockedByEnv: false, source: "runtime_preferences" };
  }
  const fromRuntime = runtimeSliceEnv(prefs, key);
  if (fromRuntime !== undefined && fromRuntime !== "") {
    return { value: fromRuntime, lockedByEnv: false, source: "runtime_preferences" };
  }
  const fromHarness = prefs?.harness?.env?.[key]?.trim();
  if (fromHarness !== undefined && fromHarness !== "") {
    return { value: fromHarness, lockedByEnv: false, source: "harness_preferences" };
  }
  const d = HARNESS_ENV_DEFAULTS[key];
  if (d !== undefined && d !== "") {
    return { value: d, lockedByEnv: false, source: "product_default" };
  }
  return { value: undefined, lockedByEnv: false, source: "unset" };
}
