/** Browser-safe: import model packs from core subpath (no Node async_hooks). */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
} from "@liminal/core/defaults";
import {
  PROVIDER_MODEL_PRESETS,
  resolveProviderModelPresetId,
} from "@liminal/core/provider-presets";

export const PROVIDER_PRESET_CUSTOM_ID = "custom";

export interface ProviderPreset {
  id: string;
  label: string;
  hint: string;
  baseURL: string;
  model: string;
  harnessEnvPatch?: Record<string, string>;
}

/** Quick-switch targets for Settings → Provider (manual edits still allowed). */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: PROVIDER_PRESET_CUSTOM_ID,
    label: "Custom…",
    hint: "No automatic fill — edit model and base URL below.",
    baseURL: "",
    model: "",
  },
  ...PROVIDER_MODEL_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    hint: p.hint,
    baseURL: p.baseURL,
    model: p.model,
    harnessEnvPatch: p.harnessEnvPatch,
  })),
  {
    id: "lmstudio",
    label: "LM Studio (local :1234)",
    hint: "Local OpenAI-compatible server — match the Model ID shown in LM Studio.",
    baseURL: "http://localhost:1234/v1",
    model: DEFAULT_AGENT_MODEL_SLUG,
    harnessEnvPatch: {
      AGENT_API_BASE_URL: "http://localhost:1234/v1",
      AGENT_FAST_MODEL: DEFAULT_AGENT_MODEL_SLUG,
    },
  },
  {
    id: "ollama",
    label: "Ollama (local :11434)",
    hint: "`ollama serve` — typical slug `qwen3.5:9b` (pull via `ollama pull qwen3.5:9b`).",
    baseURL: "http://localhost:11434/v1",
    model: "qwen3.5:9b",
    harnessEnvPatch: { AGENT_FAST_MODEL: "qwen3.5:9b" },
  },
];

export function normalizeProviderBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function resolvePresetSelection(model: string, baseURL: string): string {
  const cloud = resolveProviderModelPresetId(model, baseURL);
  if (cloud) return cloud;
  const m = model.trim();
  const b = normalizeProviderBase(baseURL);
  for (const p of PROVIDER_PRESETS) {
    if (p.id === PROVIDER_PRESET_CUSTOM_ID) continue;
    if (!p.baseURL) continue;
    if (normalizeProviderBase(p.baseURL) === b && p.model === m) return p.id;
  }
  return PROVIDER_PRESET_CUSTOM_ID;
}
