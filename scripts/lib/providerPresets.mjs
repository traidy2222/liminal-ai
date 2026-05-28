/** @typedef {{ id: string; label: string; baseURL: string; model: string; apiKey: string; needsKey: boolean; hint?: string }} ProviderPreset */

/** @type {ProviderPreset[]} */
export const PROVIDER_PRESETS = [
  {
    id: "deepseek-v4",
    label: "OpenRouter — DeepSeek V4 Pro + Flash (recommended)",
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-pro",
    apiKey: "",
    needsKey: true,
    hint: "Main: deepseek-v4-pro. Fast sidecar: deepseek-v4-flash. Key: https://openrouter.ai/keys",
  },
  {
    id: "mimo-v2.5",
    label: "OpenRouter — Xiaomi MiMo V2.5 Pro + MiMo V2.5",
    baseURL: "https://openrouter.ai/api/v1",
    model: "xiaomi/mimo-v2.5-pro",
    apiKey: "",
    needsKey: true,
    hint: "Main: mimo-v2.5-pro. Fast sidecar: mimo-v2.5. Key: https://openrouter.ai/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek API direct + deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
    needsKey: true,
    hint: "Get a key at https://platform.deepseek.com/",
  },
  {
    id: "lmstudio",
    label: "Local LM Studio (http://localhost:1234/v1)",
    baseURL: "http://localhost:1234/v1",
    model: "qwen/qwen3.5-9b",
    apiKey: "lm-studio",
    needsKey: false,
    hint: "Load a model in LM Studio and enable the local server.",
  },
  {
    id: "ollama",
    label: "Local Ollama (http://localhost:11434/v1)",
    baseURL: "http://localhost:11434/v1",
    model: "qwen3.5:9b",
    apiKey: "ollama",
    needsKey: false,
    hint: "Run `ollama pull qwen3.5:9b` (or your model tag).",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible endpoint",
    baseURL: "",
    model: "",
    apiKey: "",
    needsKey: true,
  },
];

/** @param {number} index */
export function presetByIndex(index) {
  return PROVIDER_PRESETS[index - 1] ?? null;
}

/** @param {string} id */
export function presetById(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
}
