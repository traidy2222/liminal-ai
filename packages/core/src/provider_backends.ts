import { DEFAULT_AGENT_API_BASE_URL } from "./harness_default_constants.js";
import { isKimchiApiBaseUrl } from "./kimchi_constants.js";
import { KIMCHI_API_BASE_URL } from "./kimchi_constants.js";
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

function _buildProviderBackends(): readonly ProviderBackendWire[] {
  return [
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
}

let _providerBackendsCache: readonly ProviderBackendWire[] | null = null;

export function getProviderBackends(): readonly ProviderBackendWire[] {
  if (!_providerBackendsCache) {
    _providerBackendsCache = _buildProviderBackends();
  }
  return _providerBackendsCache;
}

export const PROVIDER_BACKENDS: readonly ProviderBackendWire[] = new Proxy([] as ProviderBackendWire[], {
  get(target, prop) {
    const backends = getProviderBackends();
    return Reflect.get(backends, prop, backends);
  },
}) as unknown as readonly ProviderBackendWire[];

export function listProviderBackendsForSettings(): readonly ProviderBackendWire[] {
  return getProviderBackends();
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
  const row = getProviderBackends().find((b) => b.id === backend);
  return row?.apiKeyEnv ?? "AGENT_API_KEY";
}
