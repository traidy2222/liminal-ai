/** Browser-safe: do not import `@liminal/core` entry (pulls Node `async_hooks`). */
import { DEFAULT_AGENT_API_BASE_URL, DEFAULT_AGENT_MODEL_SLUG } from "@liminal/core/defaults";

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
  {
    id: "openrouter",
    label: "OpenRouter (cloud)",
    hint: "https://openrouter.ai — set a real key in `.env` (`AGENT_API_KEY` or `OPENROUTER_API_KEY`).",
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-pro",
    harnessEnvPatch: { AGENT_FAST_MODEL: "deepseek/deepseek-v4-pro" },
  },
  {
    id: "lmstudio",
    label: "LM Studio (local :1234)",
    hint: "Local OpenAI-compatible server — match the Model ID shown in LM Studio.",
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    model: DEFAULT_AGENT_MODEL_SLUG,
    harnessEnvPatch: { AGENT_FAST_MODEL: DEFAULT_AGENT_MODEL_SLUG },
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
  const m = model.trim();
  const b = normalizeProviderBase(baseURL);
  for (const p of PROVIDER_PRESETS) {
    if (p.id === PROVIDER_PRESET_CUSTOM_ID) continue;
    if (!p.baseURL) continue;
    if (normalizeProviderBase(p.baseURL) === b && p.model === m) return p.id;
  }
  return PROVIDER_PRESET_CUSTOM_ID;
}
