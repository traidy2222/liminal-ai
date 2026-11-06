import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  providerConnectionConfigured,validateProviderSetup,persistValidatedProvider,
  buildHarnessSettingsApiFields,
  HARNESS_SETTINGS_TABS,
  HARNESS_MANAGED_ENV_KEY_SET,
  harnessEnvResolutionMeta,
  resolveHarnessEnvRaw,
  resolveSpeechSynthesisConfig,
  resolveWakeVoiceConfig,
  type WakeVoiceConfig,
  ensureProviderApiKeysInProcess,
  hasLocalProviderApiKey,
  isProviderApiKeyConfigured,
  resolveInferenceMode,
  resolveProviderConfig,
  syncProviderProcessEnvForBase,
  buildByokRoutingPatchForModel,
  DEFAULT_AGENT_API_BASE_URL,
  loadRuntimePreferences,
  type RuntimePreferences,
} from "@liminal/core";
import {
  apiKeyEnvVarForBaseUrl,
  listBedrockModelPresetsForSettings,
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
  wakeVoice: WakeVoiceConfig;
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
  repoRoot: string,
  options?: { wakePreferences: RuntimePreferences | null }
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
    providerConnectionConfigured(cfg.openRouterApiKey);
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
    ttsVoice: resolveSpeechSynthesisConfig(prefs).voice,
    dictationAudioCue: resolveHarnessEnvRaw("AGENT_DICTATION_AUDIO_CUE", prefs) === "1",
    dictationMinRecordingMs: parseHarnessMs(prefs, "AGENT_DICTATION_MIN_RECORDING_MS", 1500),
    dictationSilenceMsShort: parseHarnessMs(prefs, "AGENT_DICTATION_SILENCE_MS_SHORT", 1500),
    dictationSilenceMsLong: parseHarnessMs(prefs, "AGENT_DICTATION_SILENCE_MS_LONG", 2500),
    dictationMaxRecordingMs: parseHarnessMs(prefs, "AGENT_DICTATION_MAX_RECORDING_MS", 60000),
    // Always-on listening belongs to the desktop, including while Home or
    // another chat is visible. A chat's older preference snapshot cannot turn
    // off the application's listener simply by becoming the active chat.
    wakeVoice: resolveWakeVoiceConfig(options ? options.wakePreferences : prefs),
  };
}

export function buildSettingsSnapshot(
  prefs: RuntimePreferences | null,
  bridge?: SessionBridge
) {
  const harnessCfg = bridge?.harness.config;
  const prefsModel = prefs?.provider?.model?.trim() || "";
  const envModel = resolveHarnessEnvRaw("AGENT_MODEL", prefs)?.trim() || "";
  const harnessModel = harnessCfg?.model?.trim() || "";
  // Persisted prefs/env are the user's explicit pick; harness.config.model can lag
  // (e.g. regional Bedrock ids like global.anthropic.claude-sonnet-4-6 vs default opus).
  const model = (prefsModel || envModel || harnessModel || "").slice(0, 200);
  const baseURL = (
    harnessCfg?.baseURL ??
    prefs?.provider?.baseURL?.trim() ??
    ""
  ).slice(0, 500);

  ensureProviderApiKeysInProcess();
  const apiKeyConfigured =
    providerConnectionConfigured(harnessCfg?.openRouterApiKey);

  const managedRoute = baseURL.includes("/inference");
  return {
    tabs: HARNESS_SETTINGS_TABS,
    fields: buildHarnessSettingsApiFields(prefs),
    providerPresets: listProviderPresetsForSettings(),
    bedrockPresets: listBedrockModelPresetsForSettings(),
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
  if(registry.anyHarnessBusy())throw new Error('Finish the current turn before changing providers.');
  const validated=await validateProviderSetup(input);
  const patch=await persistValidatedProvider(validated);
  await registry.applyRuntimePreferencesPatch(patch,repoRoot);
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
  }
  if (body.provider && typeof body.provider === "object") {
    const prov: NonNullable<RuntimePreferences["provider"]> = { ...prefs?.provider };
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

  const modelCandidate =
    runtimePatch.provider?.model?.trim() ||
    envPatch.AGENT_MODEL?.trim() ||
    "";
  const explicitMode = runtimePatch.provider?.inferenceMode;
  if (modelCandidate && explicitMode !== "managed") {
    const mergedPrefs: RuntimePreferences = {
      version: prefs?.version ?? 1,
      updatedAt: prefs?.updatedAt ?? Date.now(),
      provider: { ...prefs?.provider, ...runtimePatch.provider },
      harness: {
        env: { ...prefs?.harness?.env, ...(runtimePatch.harness?.env ?? {}) },
      },
    };
    const byokPatch = buildByokRoutingPatchForModel(modelCandidate, mergedPrefs);
    if (byokPatch) {
      runtimePatch.provider = { ...runtimePatch.provider, ...byokPatch.provider };
      runtimePatch.harness = {
        env: {
          ...(runtimePatch.harness?.env ?? {}),
          ...(byokPatch.harness?.env ?? {}),
        },
      };
    }
  }

  if (runtimePatch.provider?.inferenceMode === "byok") {
    runtimePatch.harness = {
      env: {
        ...(runtimePatch.harness?.env ?? {}),
        AGENT_INFERENCE_MODE: "byok",
        AGENT_INFERENCE_PREFER_MANAGED: "0",
      },
    };
  } else if (runtimePatch.provider?.inferenceMode === "managed") {
    runtimePatch.harness = {
      env: {
        ...(runtimePatch.harness?.env ?? {}),
        AGENT_INFERENCE_MODE: "managed",
        AGENT_INFERENCE_PREFER_MANAGED: "1",
      },
    };
    // Drop pinned BYOK base URL so routing uses the Vireon proxy.
    if (runtimePatch.provider?.baseURL && !runtimePatch.provider.baseURL.includes("/inference")) {
      delete runtimePatch.provider.baseURL;
    }
  }

  await registry.applyRuntimePreferencesPatch(runtimePatch);
  const nextBase =
    runtimePatch.provider?.baseURL?.trim() ||
    active.harness.getRuntimePreferences()?.provider?.baseURL?.trim();
  if (nextBase) {
    syncProviderProcessEnvForBase(nextBase);
  }
  await registry.reapplyAllProviders();
}
