/** Browser-safe: import model packs from core subpath (no Node async_hooks). */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
} from "@liminal/core/defaults";
import {
  listProviderPresetsForSettings,
  PROVIDER_PRESET_CUSTOM_ID,
  resolveProviderPresetId,
  type ProviderPresetWire,
} from "@liminal/core/provider-presets";

export { PROVIDER_PRESET_CUSTOM_ID };

export type ProviderPreset = ProviderPresetWire;

/** Quick-switch targets for Settings → Provider (manual edits still allowed). */
export const PROVIDER_PRESETS: ProviderPreset[] = [...listProviderPresetsForSettings()];

export function normalizeProviderBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function resolvePresetSelection(model: string, baseURL: string): string {
  return resolveProviderPresetId(model, baseURL);
}

// Re-export for callers that still import defaults from this module.
export { DEFAULT_AGENT_API_BASE_URL, DEFAULT_AGENT_MODEL_SLUG };
