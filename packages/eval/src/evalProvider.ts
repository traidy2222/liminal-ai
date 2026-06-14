/**
 * Eval provider resolution — defaults to Vireon managed inference on Bedrock (GLM-5 main,
 * GLM-4.7-flash fast) when a license is available; falls back to BYOK when not.
 */
import {
  hasLocalProviderApiKey,
  loadRuntimePreferences,
  resolveHarnessEnvRaw,
  resolveInferenceMode,
  resolveLicenseTokenForHarness,
  resolveManagedProviderPreference,
  resolveProviderConfigWithInference,
  type ProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";

/** Bedrock model ids for the default eval / sandbox lab stack. */
export const EVAL_DEFAULT_MAIN_MODEL = "zai.glm-5";
export const EVAL_DEFAULT_FAST_MODEL = "zai.glm-4.7-flash";

/** Harness env merged into sandbox runs (and eval when EVAL_MANAGED_DEFAULTS=1). */
export const EVAL_MANAGED_BEDROCK_ENV: Record<string, string> = {
  AGENT_INFERENCE_MODE: "managed",
  AGENT_INFERENCE_PREFER_MANAGED: "1",
  AGENT_MANAGED_PROVIDER: "bedrock",
  AGENT_MODEL: EVAL_DEFAULT_MAIN_MODEL,
  AGENT_FAST_MODEL: EVAL_DEFAULT_FAST_MODEL,
};

function evalManagedDefaultsEnabled(): boolean {
  const raw = process.env["EVAL_MANAGED_DEFAULTS"]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  // Sandbox + desktop-parity evals use Vireon managed Bedrock (GLM-5 / GLM-4.7-flash).
  return (
    process.env["EVAL_SANDBOX_LAB"] === "1" || process.env["EVAL_DESKTOP_PARITY"] === "1"
  );
}

export function mergeEvalManagedEnv(base: Record<string, string>): Record<string, string> {
  if (!evalManagedDefaultsEnabled()) return base;
  return { ...EVAL_MANAGED_BEDROCK_ENV, ...base };
}

export function evalMainModelSlug(): string {
  return (
    process.env["EVAL_MODEL"]?.trim() ||
    process.env["AGENT_MODEL"]?.trim() ||
    EVAL_DEFAULT_MAIN_MODEL
  );
}

export function evalFastModelSlug(): string {
  return (
    process.env["EVAL_FAST_MODEL"]?.trim() ||
    process.env["AGENT_FAST_MODEL"]?.trim() ||
    EVAL_DEFAULT_FAST_MODEL
  );
}

export async function evalCredentialsAvailable(): Promise<boolean> {
  if (hasLocalProviderApiKey()) return true;
  const license = await resolveLicenseTokenForHarness();
  return Boolean(license?.trim());
}

export function evalActiveMainModelSlug(): string {
  return process.env["AGENT_MODEL"]?.trim() || evalMainModelSlug();
}

export async function resolveEvalProvider(
  prefs?: RuntimePreferences | null
): Promise<ProviderConfig> {
  const runtimePrefs = prefs ?? (await loadRuntimePreferences());
  return resolveProviderConfigWithInference(
    { model: evalActiveMainModelSlug() },
    runtimePrefs
  );
}

export type EvalProviderSummary = {
  mainModel: string;
  fastModel: string;
  inferenceMode: string;
  managedProvider: string;
  route: string;
  keySource: string;
};

export async function describeEvalProvider(): Promise<EvalProviderSummary> {
  const prefs = await loadRuntimePreferences();
  const provider = await resolveEvalProvider(prefs);
  const inferenceMode = resolveInferenceMode(prefs);
  const managedProvider = resolveManagedProviderPreference(prefs);
  const fastModel = evalFastModelSlug();
  const route =
    provider.keySource === "VIREON_MANAGED"
      ? `managed · ${managedProvider}`
      : inferenceMode === "byok"
        ? "byok"
        : inferenceMode;
  return {
    mainModel: provider.model,
    fastModel,
    inferenceMode,
    managedProvider,
    route,
    keySource: provider.keySource,
  };
}

export function formatEvalProviderLine(summary: EvalProviderSummary): string {
  return `model: ${summary.mainModel} · fast: ${summary.fastModel} · ${summary.route} (${summary.keySource})`;
}

/** Apply eval model env for the current process (after scenario env patches). */
export function applyEvalModelEnv(): void {
  if (process.env["EVAL_MODEL"]?.trim()) {
    process.env["AGENT_MODEL"] = process.env["EVAL_MODEL"]!.trim();
  }
  if (process.env["EVAL_FAST_MODEL"]?.trim()) {
    process.env["AGENT_FAST_MODEL"] = process.env["EVAL_FAST_MODEL"]!.trim();
  }
  if (!process.env["AGENT_MODEL"]?.trim()) {
    process.env["AGENT_MODEL"] = evalMainModelSlug();
  }
  if (!process.env["AGENT_FAST_MODEL"]?.trim()) {
    process.env["AGENT_FAST_MODEL"] = evalFastModelSlug();
  }
}

export async function assertEvalCredentials(): Promise<void> {
  if (await evalCredentialsAvailable()) return;
  throw new Error(
    "No eval credentials — sign in with `liminal login` (managed inference) or set AGENT_API_KEY in .env."
  );
}

/** True when managed inference is the active eval route. */
export async function evalUsesManagedInference(): Promise<boolean> {
  const provider = await resolveEvalProvider();
  return provider.keySource === "VIREON_MANAGED";
}

export function readEvalInferenceMode(): string {
  return resolveHarnessEnvRaw("AGENT_INFERENCE_MODE", null) ?? "auto";
}
