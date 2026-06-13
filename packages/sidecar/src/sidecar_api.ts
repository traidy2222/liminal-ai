import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildHarnessSettingsApiFields,
  HARNESS_SETTINGS_TABS,
  HARNESS_MANAGED_ENV_KEY_SET,
  harnessEnvResolutionMeta,
  resolveHarnessEnvRaw,
  ensureProviderApiKeysInProcess,
  isProviderApiKeyConfigured,
  resolveInferenceMode,
  resolveProviderConfig,
  syncProviderProcessEnvForBase,
  readDesktopPrefs,
  type RuntimePreferences,
} from "@liminal/core";
import {
  apiKeyEnvVarForBaseUrl,
  listProviderBackendsForSettings,
  listProviderPresetsForSettings,
  resolveProviderBackendId,
  resolveProviderPresetId,
} from "@liminal/core/provider-presets";
import type { PersonaUiThemeV2, PersonaUiCopy } from "@liminal/core";
import type { WireAppConfig } from "@liminal/protocol";
import { loadPersonaUiThemeFromWorkspace, loadPersonaUiCopyFromWorkspace } from "@liminal/tools";
import type { SessionBridge } from "./session_bridge.js";
import type { ChatRegistry } from "./chat_registry.js";
import { applyApiKeyToProcess, firstApiKeyFromEnv, writeEnvMerge } from "./env_file.js";

export interface DesktopConfigSnapshot {
  apiKeyConfigured: boolean;
  personaBootstrapEnabled: boolean;
  personaBootstrapPending: boolean;
  personaBootstrapAllowSkip: boolean;
  personaDisplayLabel: string;
  provider: {
    model: string;
    baseURL: string;
    modelLockedByEnv: boolean;
    baseURLLockedByEnv: boolean;
  };
  repoRoot: string;
  personaUiTheme?: PersonaUiThemeV2;
  personaUiCopy?: PersonaUiCopy;
  ttsEnabled: boolean;
  ttsVoice: string;
  dictationAudioCue: boolean;
  dictationMinRecordingMs: number;
  dictationSilenceMsShort: number;
  dictationSilenceMsLong: number;
  dictationMaxRecordingMs: number;
  defaultWorkspaceFolder?: string | null;
}

function parseHarnessMs(prefs: RuntimePreferences | null, key: string, fallback: number): number {
  const raw = resolveHarnessEnvRaw(key, prefs)?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** JSON-safe config for WS `hello` / `sidecar_ready` (persona theme as plain object). */
export function wireAppConfig(snapshot: DesktopConfigSnapshot): WireAppConfig {
  const { personaUiTheme, personaUiCopy, ...rest } = snapshot;
  return {
    ...rest,
    ...(personaUiTheme
      ? { personaUiTheme: personaUiTheme as unknown as Record<string, unknown> }
      : {}),
    ...(personaUiCopy
      ? { personaUiCopy: personaUiCopy as unknown as Record<string, unknown> }
      : {}),
  };
}

export async function buildDesktopConfig(
  bridge: SessionBridge,
  repoRoot: string
): Promise<DesktopConfigSnapshot> {
  const prefs = bridge.harness.getRuntimePreferences();
  const cfg = bridge.harness.config;
  let personaDisplayLabel = "Liminal";
  let personaUiTheme: PersonaUiThemeV2 | undefined;
  let personaUiCopy: PersonaUiCopy | undefined;
  try {
    const theme = await loadPersonaUiThemeFromWorkspace();
    if (theme) personaUiTheme = theme;
    personaDisplayLabel =
      theme?.displayLabel?.trim() || bridge.harness.getCurrentPersona()?.name?.trim() || "Liminal";
  } catch {
    personaDisplayLabel = bridge.harness.getCurrentPersona()?.name?.trim() || "Liminal";
  }
  try {
    const copy = await loadPersonaUiCopyFromWorkspace();
    if (copy) personaUiCopy = copy;
  } catch {
    /* defaults applied client-side */
  }
  ensureProviderApiKeysInProcess();
  const apiKeyConfigured =
    !!(cfg.openRouterApiKey?.trim()) ||
    isProviderApiKeyConfigured({ baseURL: cfg.baseURL });
  const desktopPrefs = await readDesktopPrefs();
  return {
    apiKeyConfigured,
    personaBootstrapEnabled: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) !== "0",
    personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
    personaBootstrapAllowSkip: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP", prefs) !== "0",
    personaDisplayLabel,
    provider: {
      model: (cfg.model ?? "").slice(0, 200),
      baseURL: (cfg.baseURL ?? "").slice(0, 500),
      modelLockedByEnv: false,
      baseURLLockedByEnv: false,
    },
    repoRoot,
    ...(personaUiTheme ? { personaUiTheme } : {}),
    ...(personaUiCopy ? { personaUiCopy } : {}),
    ttsEnabled: resolveHarnessEnvRaw("AGENT_TTS_ENABLED", prefs) === "1",
    ttsVoice: resolveHarnessEnvRaw("AGENT_TTS_VOICE", prefs)?.trim() || "af_sky",
    dictationAudioCue: resolveHarnessEnvRaw("AGENT_DICTATION_AUDIO_CUE", prefs) === "1",
    dictationMinRecordingMs: parseHarnessMs(prefs, "AGENT_DICTATION_MIN_RECORDING_MS", 1500),
    dictationSilenceMsShort: parseHarnessMs(prefs, "AGENT_DICTATION_SILENCE_MS_SHORT", 1500),
    dictationSilenceMsLong: parseHarnessMs(prefs, "AGENT_DICTATION_SILENCE_MS_LONG", 2500),
    dictationMaxRecordingMs: parseHarnessMs(prefs, "AGENT_DICTATION_MAX_RECORDING_MS", 60000),
    defaultWorkspaceFolder: desktopPrefs.defaultWorkspaceFolder ?? null,
  };
}

export function buildSettingsSnapshot(
  prefs: RuntimePreferences | null,
  bridge?: SessionBridge
) {
  const harnessCfg = bridge?.harness.config;
  const model = (
    harnessCfg?.model ??
    prefs?.provider?.model?.trim() ??
    ""
  ).slice(0, 200);
  const baseURL = (
    harnessCfg?.baseURL ??
    prefs?.provider?.baseURL?.trim() ??
    ""
  ).slice(0, 500);

  ensureProviderApiKeysInProcess();
  const apiKeyConfigured =
    !!(harnessCfg?.openRouterApiKey?.trim()) ||
    isProviderApiKeyConfigured({ baseURL: baseURL || undefined });

  const managedRoute = baseURL.includes("/inference");
  return {
    tabs: HARNESS_SETTINGS_TABS,
    fields: buildHarnessSettingsApiFields(prefs),
    providerPresets: listProviderPresetsForSettings(),
    providerBackends: listProviderBackendsForSettings(),
    provider: {
      model,
      baseURL,
      modelLockedByEnv: false,
      baseURLLockedByEnv: false,
      apiKeyConfigured,
      managedRoute,
      inferenceMode: resolveInferenceMode(prefs),
      resolvedPresetId: resolveProviderPresetId(model, baseURL),
      resolvedBackendId: managedRoute ? "managed" : resolveProviderBackendId(baseURL),
    },
    hint: managedRoute
      ? "Pro managed inference — models route through Vireon (no API key in .env)."
      : "API keys are stored in .env only and are never sent over the desktop protocol. " +
        "Sign in to Vireon for Pro managed inference, or set BYOK keys in .env.",
  };
}

export async function saveProviderCredentials(
  registry: ChatRegistry,
  repoRoot: string,
  input: { apiKey?: string; model?: string; baseURL?: string }
): Promise<void> {
  const key = (input.apiKey ?? "").trim();
  const model = input.model?.trim();
  const baseURL = input.baseURL?.trim();

  if (key.length > 0 && key.length < 8) {
    throw new Error("API key is too short.");
  }

  const effectiveBase =
    baseURL?.trim() ||
    process.env["AGENT_API_BASE_URL"]?.trim() ||
    "";
  const keyEnvVar = /^castai_v1_/i.test(key)
    ? "KIMCHI_API_KEY"
    : apiKeyEnvVarForBaseUrl(effectiveBase);

  const updates: Record<string, string> = {};
  if (key.length >= 8) updates[keyEnvVar] = key;
  const prefsPatch: Partial<RuntimePreferences> = {};
  if (model || baseURL) {
    prefsPatch.provider = {
      ...(model ? { model: model.slice(0, 200) } : {}),
      ...(baseURL ? { baseURL: baseURL.slice(0, 500) } : {}),
    };
  }

  if (Object.keys(updates).length === 0 && !prefsPatch.provider) {
    throw new Error("Nothing to save — enter a new API key or change model/base URL.");
  }

  if (Object.keys(updates).length > 0) {
    if (!existsSync(join(repoRoot, "packages", "sidecar"))) {
      throw new Error(`Invalid repo root: ${repoRoot}`);
    }
    writeEnvMerge(repoRoot, updates);
    const savedKey = updates[keyEnvVar];
    if (savedKey) {
      applyApiKeyToProcess(savedKey, keyEnvVar);
      if (keyEnvVar === "OPENROUTER_API_KEY") {
        applyApiKeyToProcess(savedKey, "AGENT_API_KEY");
      } else if (keyEnvVar === "KIMCHI_API_KEY" || keyEnvVar === "CASTAI_API_KEY") {
        delete process.env["AGENT_API_KEY"];
      }
    }
  }

  if (baseURL) {
    syncProviderProcessEnvForBase(baseURL);
  }

  await registry.reloadRuntimePrefs();
  if (prefsPatch.provider) {
    const active = registry.getActiveBridge();
    if (active && !active.harness.getIsRunning()) {
      await active.harness.patchRuntimePreferences(prefsPatch, { persist: true });
    }
  }
  await registry.reapplyAllProviders();
}

export async function patchHarnessSettings(
  registry: ChatRegistry,
  patch: Record<string, unknown>
): Promise<void> {
  const body = patch as {
    harness?: { env?: Record<string, string> };
    provider?: { model?: string; baseURL?: string; inferenceMode?: string };
  };
  const active = registry.getActiveBridge();
  if (!active) throw new Error("No active chat.");
  if (active.harness.getIsRunning()) {
    throw new Error("Agent is busy; wait for the current turn before saving settings.");
  }
  const prefs = active.harness.getRuntimePreferences();
  const envPatch: Record<string, string> = {};
  const envIn = body.harness?.env;
  if (envIn && typeof envIn === "object") {
    for (const [k, v] of Object.entries(envIn)) {
      if (!HARNESS_MANAGED_ENV_KEY_SET.has(k)) continue;
      if (harnessEnvResolutionMeta(k, prefs).lockedByEnv) continue;
      if (typeof v !== "string") continue;
      envPatch[k] = v.trim().slice(0, 8000);
    }
  }
  const runtimePatch: Partial<RuntimePreferences> = {};
  if (Object.keys(envPatch).length > 0) {
    runtimePatch.harness = { env: envPatch };
    if (envPatch.AGENT_MODEL && !body.provider?.model) {
      runtimePatch.provider = {
        ...(prefs?.provider ?? {}),
        ...(runtimePatch.provider ?? {}),
        model: envPatch.AGENT_MODEL,
      };
    }
  }
  if (body.provider && typeof body.provider === "object") {
    const prov: NonNullable<RuntimePreferences["provider"]> = {
      ...(runtimePatch.provider ?? prefs?.provider ?? {}),
    };
    if (typeof body.provider.model === "string") {
      const m = body.provider.model.trim();
      if (m) prov.model = m.slice(0, 200);
    }
    if (typeof body.provider.baseURL === "string") {
      const b = body.provider.baseURL.trim();
      if (b) prov.baseURL = b.slice(0, 500);
      else delete prov.baseURL;
    }
    const mode = body.provider.inferenceMode?.trim().toLowerCase();
    if (mode === "byok" || mode === "managed" || mode === "auto") {
      prov.inferenceMode = mode;
    }
    runtimePatch.provider = prov;
  }
  if (!runtimePatch.harness && !runtimePatch.provider) {
    throw new Error("No valid harness.env or provider fields in patch.");
  }
  await active.harness.patchRuntimePreferences(runtimePatch, { persist: true });
  await registry.reloadRuntimePrefs();
  const nextBase =
    runtimePatch.provider?.baseURL?.trim() ||
    active.harness.getRuntimePreferences()?.provider?.baseURL?.trim();
  if (nextBase) {
    syncProviderProcessEnvForBase(nextBase);
  }
  await registry.reapplyAllProviders();
}
