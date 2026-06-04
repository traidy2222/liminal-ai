import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildHarnessSettingsApiFields,
  HARNESS_SETTINGS_TABS,
  HARNESS_MANAGED_ENV_KEY_SET,
  harnessEnvResolutionMeta,
  resolveHarnessEnvRaw,
  resolveInferenceMode,
  resolveProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";
import type { PersonaUiThemeV2 } from "@liminal/core";
import type { WireAppConfig } from "@liminal/protocol";
import { loadPersonaUiThemeFromWorkspace } from "@liminal/tools";
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
}

/** JSON-safe config for WS `hello` / `sidecar_ready` (persona theme as plain object). */
export function wireAppConfig(snapshot: DesktopConfigSnapshot): WireAppConfig {
  const { personaUiTheme, ...rest } = snapshot;
  return {
    ...rest,
    ...(personaUiTheme
      ? { personaUiTheme: personaUiTheme as unknown as Record<string, unknown> }
      : {}),
  };
}

export async function buildDesktopConfig(
  bridge: SessionBridge,
  repoRoot: string
): Promise<DesktopConfigSnapshot> {
  const prefs = bridge.harness.getRuntimePreferences();
  const cfg = bridge.harness.config;
  const envModel = process.env["AGENT_MODEL"]?.trim();
  const envBase = process.env["AGENT_API_BASE_URL"]?.trim();
  let personaDisplayLabel = "Liminal";
  let personaUiTheme: PersonaUiThemeV2 | undefined;
  try {
    const theme = await loadPersonaUiThemeFromWorkspace();
    if (theme) personaUiTheme = theme;
    personaDisplayLabel =
      theme?.displayLabel?.trim() || bridge.harness.getCurrentPersona()?.name?.trim() || "Liminal";
  } catch {
    personaDisplayLabel = bridge.harness.getCurrentPersona()?.name?.trim() || "Liminal";
  }
  const apiKeyConfigured = !!(cfg.openRouterApiKey?.trim() || firstApiKeyFromEnv(repoRoot));
  return {
    apiKeyConfigured,
    personaBootstrapEnabled: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) !== "0",
    personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
    personaBootstrapAllowSkip: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP", prefs) !== "0",
    personaDisplayLabel,
    provider: {
      model: (cfg.model ?? "").slice(0, 200),
      baseURL: (cfg.baseURL ?? "").slice(0, 500),
      modelLockedByEnv: !!envModel,
      baseURLLockedByEnv: !!envBase,
    },
    repoRoot,
    ...(personaUiTheme ? { personaUiTheme } : {}),
  };
}

export function buildSettingsSnapshot(prefs: RuntimePreferences | null) {
  const cfg = resolveProviderConfig();
  const envModel = process.env["AGENT_MODEL"]?.trim();
  const envBase = process.env["AGENT_API_BASE_URL"]?.trim();
  return {
    tabs: HARNESS_SETTINGS_TABS,
    fields: buildHarnessSettingsApiFields(prefs),
    provider: {
      model: (cfg.model ?? "").slice(0, 200),
      baseURL: (cfg.baseURL ?? "").slice(0, 500),
      modelLockedByEnv: !!envModel,
      baseURLLockedByEnv: !!envBase,
      apiKeyConfigured: !!(cfg.apiKey?.trim()),
      inferenceMode: resolveInferenceMode(prefs),
    },
    hint:
      "API keys are stored in .env only and are never sent over the desktop protocol. Use save_provider to set AGENT_API_KEY.",
  };
}

export async function saveProviderCredentials(
  registry: ChatRegistry,
  repoRoot: string,
  input: { apiKey: string; model?: string; baseURL?: string }
): Promise<void> {
  const key = input.apiKey.trim();
  if (key.length < 8) {
    throw new Error("API key is too short.");
  }
  if (!existsSync(join(repoRoot, "packages", "sidecar"))) {
    throw new Error(`Invalid repo root: ${repoRoot}`);
  }
  const updates: Record<string, string> = { AGENT_API_KEY: key };
  if (input.model?.trim() && !process.env["AGENT_MODEL"]?.trim()) {
    updates["AGENT_MODEL"] = input.model.trim().slice(0, 200);
  }
  if (input.baseURL?.trim() && !process.env["AGENT_API_BASE_URL"]?.trim()) {
    updates["AGENT_API_BASE_URL"] = input.baseURL.trim().slice(0, 500);
  }
  writeEnvMerge(repoRoot, updates);
  applyApiKeyToProcess(key);

  const prefsPatch: Partial<RuntimePreferences> = {};
  if (input.model?.trim() || input.baseURL?.trim()) {
    prefsPatch.provider = {
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      ...(input.baseURL?.trim() ? { baseURL: input.baseURL.trim() } : {}),
    };
  }

  await registry.reloadRuntimePrefs();
  if (Object.keys(prefsPatch).length > 0) {
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
  }
  if (body.provider && typeof body.provider === "object") {
    const prov: NonNullable<RuntimePreferences["provider"]> = { ...prefs?.provider };
    if (!process.env["AGENT_MODEL"]?.trim() && typeof body.provider.model === "string") {
      const m = body.provider.model.trim();
      if (m) prov.model = m.slice(0, 200);
    }
    if (!process.env["AGENT_API_BASE_URL"]?.trim() && typeof body.provider.baseURL === "string") {
      const b = body.provider.baseURL.trim();
      if (b) prov.baseURL = b.slice(0, 500);
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
}
