export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  keySource:
    | "AGENT_API_KEY"
    | "OPENROUTER_API_KEY"
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "XAI_API_KEY";
}

export interface ProviderConfigOverrides {
  baseURL?: string;
  model?: string;
  keySource?: ProviderConfig["keySource"];
}

export interface VisionProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/owl-alpha";

function firstNonEmpty(
  keys: Array<ProviderConfig["keySource"]>
): { key: ProviderConfig["keySource"]; value: string } | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

export function resolveProviderConfig(overrides?: ProviderConfigOverrides): ProviderConfig {
  const order: Array<ProviderConfig["keySource"]> = overrides?.keySource
    ? [overrides.keySource, "AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"]
    : ["AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"];
  const picked = firstNonEmpty(order);
  if (!picked) {
    throw new Error(
      "No API key found. Set AGENT_API_KEY (preferred) or one of OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY."
    );
  }
  const baseURL = (overrides?.baseURL ?? process.env["AGENT_API_BASE_URL"]?.trim()) || DEFAULT_BASE_URL;
  const model = (overrides?.model ?? process.env["AGENT_MODEL"]?.trim()) || DEFAULT_MODEL;
  return {
    apiKey: picked.value,
    baseURL,
    model,
    keySource: picked.key,
  };
}

export function resolveVisionProviderConfig(): VisionProviderConfig {
  const base = resolveProviderConfig();
  return {
    apiKey:
      process.env["AGENT_VISION_API_KEY"]?.trim() ||
      base.apiKey,
    baseURL:
      process.env["AGENT_VISION_BASE_URL"]?.trim() ||
      base.baseURL,
    model:
      process.env["AGENT_VISION_MODEL"]?.trim() ||
      base.model,
  };
}

