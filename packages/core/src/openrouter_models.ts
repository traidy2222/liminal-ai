/**
 * OpenRouter model catalog — context windows from GET /v1/models.
 * @see https://openrouter.ai/docs/api/api-reference/models/get-models
 */
import { isOpenRouterApiBaseUrl, supportsOpenRouterRequestExtras } from "./openrouter_session.js";

export type OpenRouterModelLimits = {
  contextLength: number;
  maxCompletionTokens?: number;
};

export type OpenRouterModelsListResponse = {
  data?: Array<{
    id?: string;
    context_length?: number | null;
    top_provider?: {
      context_length?: number | null;
      max_completion_tokens?: number | null;
    } | null;
  }>;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
let catalogCache: { at: number; baseURL: string; catalog: Map<string, OpenRouterModelLimits> } | null =
  null;

function positiveInt(n: unknown): number | undefined {
  const v = typeof n === "number" ? n : typeof n === "string" ? parseInt(n, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

/** Parse one OpenRouter model row into context limits. */
export function parseOpenRouterModelLimits(
  row: NonNullable<OpenRouterModelsListResponse["data"]>[number]
): OpenRouterModelLimits | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  const modelCtx = positiveInt(row.context_length);
  const providerCtx = positiveInt(row.top_provider?.context_length);
  let contextLength: number | undefined;
  if (modelCtx != null && providerCtx != null) {
    contextLength = Math.min(modelCtx, providerCtx);
  } else {
    contextLength = modelCtx ?? providerCtx;
  }
  if (contextLength == null) return null;

  const maxCompletionTokens = positiveInt(row.top_provider?.max_completion_tokens);
  return {
    contextLength,
    ...(maxCompletionTokens != null && { maxCompletionTokens }),
  };
}

/** Parse OpenRouter GET /models body into a slug → limits map. */
export function parseOpenRouterModelCatalog(
  body: OpenRouterModelsListResponse
): Map<string, OpenRouterModelLimits> {
  const out = new Map<string, OpenRouterModelLimits>();
  const rows = Array.isArray(body.data) ? body.data : [];
  for (const row of rows) {
    const limits = parseOpenRouterModelLimits(row);
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || !limits) continue;
    out.set(id, limits);
    out.set(id.toLowerCase(), limits);
  }
  return out;
}

export function clearOpenRouterModelCatalogCache(): void {
  catalogCache = null;
}

function normalizeModelsBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/$/, "");
  return trimmed.endsWith("/models") ? trimmed.slice(0, -"/models".length) : trimmed;
}

/**
 * Fetch OpenRouter model limits (1h in-memory cache per base URL).
 * Returns empty map when the base is not OpenRouter-compatible or fetch fails.
 */
export async function fetchOpenRouterModelCatalog(
  apiKey: string,
  baseURL: string,
  opts?: { refresh?: boolean }
): Promise<Map<string, OpenRouterModelLimits>> {
  if (!supportsOpenRouterRequestExtras(baseURL) && !isOpenRouterApiBaseUrl(baseURL)) {
    return new Map();
  }
  const key = apiKey.trim();
  if (!key) return new Map();

  if (opts?.refresh) catalogCache = null;
  const normalizedBase = normalizeModelsBaseUrl(baseURL);
  if (
    catalogCache &&
    catalogCache.baseURL === normalizedBase &&
    Date.now() - catalogCache.at < CACHE_TTL_MS
  ) {
    return catalogCache.catalog;
  }

  try {
    const res = await fetch(`${normalizedBase}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) return new Map();
    const body = (await res.json()) as OpenRouterModelsListResponse;
    const catalog = parseOpenRouterModelCatalog(body);
    catalogCache = { at: Date.now(), baseURL: normalizedBase, catalog };
    return catalog;
  } catch {
    return new Map();
  }
}

/** Warm the in-memory OR catalog (fire-and-forget safe). */
export async function warmOpenRouterModelCatalog(
  apiKey: string,
  baseURL: string
): Promise<void> {
  await fetchOpenRouterModelCatalog(apiKey, baseURL);
}
