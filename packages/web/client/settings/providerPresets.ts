/** Browser-safe: import model packs from core subpath (no Node async_hooks). */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
} from "@liminal/core/defaults";
import {
  inferPresetBackend,
  listBedrockModelPresetsForSettings,
  listProviderBackendsForSettings,
  listProviderPresetsForBackend,
  listProviderPresetsForSettings,
  PROVIDER_PRESET_CUSTOM_ID,
  resolveBedrockModelPresetId,
  resolveProviderBackendId,
  resolveProviderPresetId,
  type BedrockModelPresetWire,
  type ProviderBackendWire,
  type ProviderPresetWire,
} from "@liminal/core/provider-presets";

export { inferPresetBackend, resolveBedrockModelPresetId };

export { PROVIDER_PRESET_CUSTOM_ID };

export type ProviderPreset = ProviderPresetWire;
export type ProviderBackend = ProviderBackendWire;
export type BedrockModelPreset = BedrockModelPresetWire;

/** Quick-switch Bedrock main+fast packs for managed inference Settings. */
export const BEDROCK_PRESETS: BedrockModelPreset[] = [...listBedrockModelPresetsForSettings()];

/** Quick-switch targets for Settings → Provider (manual edits still allowed). */
export const PROVIDER_PRESETS: ProviderPreset[] = [...listProviderPresetsForSettings()];
export const PROVIDER_BACKENDS: ProviderBackend[] = [...listProviderBackendsForSettings()];

export function normalizeProviderBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function resolvePresetSelection(model: string, baseURL: string): string {
  return resolveProviderPresetId(model, baseURL);
}

export function resolveBackendSelection(baseURL: string): string {
  return resolveProviderBackendId(baseURL);
}

export function presetsForBackend(backendId: string): ProviderPreset[] {
  return [...listProviderPresetsForBackend(backendId as "openrouter" | "kimchi" | "local")];
}

// Re-export for callers that still import defaults from this module.
export { DEFAULT_AGENT_API_BASE_URL, DEFAULT_AGENT_MODEL_SLUG };
