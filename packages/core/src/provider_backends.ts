import { DEFAULT_AGENT_API_BASE_URL } from "./harness_default_constants.js";
import { isKimchiApiBaseUrl, KIMCHI_API_BASE_URL } from "./kimchi_provider.js";
import { isOpenRouterApiBaseUrl } from "./openrouter_session.js";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export type ProviderBackendId = "openrouter" | "kimchi" | "local";

export interface ProviderBackendWire {
  id: ProviderBackendId;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  hint: string;
}

export const PROVIDER_BACKENDS: readonly ProviderBackendWire[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
    hint: "Hundreds of models via one API. Set OPENROUTER_API_KEY or AGENT_API_KEY.",
  },
  {
    id: "kimchi",
    label: "Kimchi (Cast AI)",
    baseURL: KIMCHI_API_BASE_URL,
    apiKeyEnv: "KIMCHI_API_KEY",
    hint: "Cast AI hosted models (kimi, minimax, nemotron). Set KIMCHI_API_KEY (castai_v1_…).",
  },
  {
    id: "local",
    label: "Local (LM Studio / Ollama)",
    baseURL: "",
    apiKeyEnv: "AGENT_API_KEY",
    hint: "Local OpenAI-compatible servers — use any placeholder key (e.g. lm-studio).",
  },
];

export function listProviderBackendsForSettings(): readonly ProviderBackendWire[] {
  return PROVIDER_BACKENDS;
}

export function resolveProviderBackendId(baseURL: string): ProviderBackendId {
  const b = normalizeBaseUrl(baseURL);
  if (!b) return "openrouter";
  if (/localhost|127\.0\.0\.1/i.test(b)) return "local";
  if (isKimchiApiBaseUrl(b)) return "kimchi";
  if (isOpenRouterApiBaseUrl(b)) return "openrouter";
  return "openrouter";
}

/** `.env` key to write when saving provider credentials for this base URL. */
export function apiKeyEnvVarForBaseUrl(baseURL: string): string {
  const backend = resolveProviderBackendId(baseURL);
  const row = PROVIDER_BACKENDS.find((b) => b.id === backend);
  return row?.apiKeyEnv ?? "AGENT_API_KEY";
}
