/**
 * Parse OpenRouter / upstream error bodies for provider identification.
 */
import { isOpenRouterStealthModel } from "./provider_config.js";

/** Max dynamic 429 ignores per harness session — prevents "all providers ignored" 404s. */
export const MAX_DYNAMIC_PROVIDER_IGNORES = 6;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** OpenRouter returns 404 when `provider.ignore` (and retries) exhaust every reseller. */
export function isExhaustedProviderRoutingMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /all\s+providers\s+(have\s+been\s+)?ignored/.test(m) ||
    /providers?\s+have\s+been\s+ignored/.test(m) ||
    /no\s+allowed\s+providers\s+are\s+available/.test(m) ||
    /no\s+providers\s+available\s+for/.test(m)
  );
}

export function isExhaustedProviderRoutingError(err: unknown): boolean {
  return isExhaustedProviderRoutingMessage(errorMessage(err));
}

/** Parse OpenRouter 404 when requested provider(s) are incompatible with the model. */
export function parseOpenRouterProviderMismatch(err: unknown): {
  requested: string[];
  available: string[];
} | null {
  const msg = errorMessage(err);
  if (!isExhaustedProviderRoutingMessage(msg)) return null;
  const parseList = (key: string): string[] => {
    const m = msg.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`, "i"));
    if (!m?.[1]) return [];
    return m[1]
      .split(",")
      .map((s) => s.replace(/["'\s]/g, ""))
      .filter(Boolean);
  };
  const requested = parseList("requested_providers");
  const available = parseList("available_providers");
  if (requested.length === 0 && available.length === 0) return null;
  return { requested, available };
}

export function isStaleStealthPinMismatch(err: unknown, modelSlug: string): boolean {
  if (isOpenRouterStealthModel(modelSlug)) return false;
  const mismatch = parseOpenRouterProviderMismatch(err);
  if (!mismatch) return false;
  return mismatch.requested.some((p) => p.toLowerCase() === "stealth");
}

/** Owl Alpha has a single Stealth endpoint; opaque Stealth 400 = upstream outage (not harness config). */
export function isOpenRouterStealthOwlProviderError(
  err: unknown,
  modelSlug?: string | null
): boolean {
  if (!isOpenRouterUpstreamProviderError(err)) return false;
  const slug = (modelSlug ?? "").trim().toLowerCase();
  if (slug === "openrouter/owl-alpha") return true;
  const provider = parseOpenRouterProviderSlug(err);
  return provider?.toLowerCase() === "stealth" && /owl-alpha/i.test(errorMessage(err));
}

export function formatOpenRouterStealthOwlUnavailableMessage(): string {
  return (
    "OpenRouter Owl Alpha (Stealth) is failing upstream (HTTP 400 Provider returned error). " +
    "This model only has one Stealth endpoint — when Stealth is down, every request fails. " +
    "Switch Settings → Free (OpenRouter router + Nemotron 3 Ultra), DeepSeek V4, or AGENT_MODEL=openrouter/free until Stealth recovers."
  );
}

/** OpenRouter upstream reseller returned a hard error (often opaque HTTP 400 on Stealth). */
export function isOpenRouterUpstreamProviderError(err: unknown): boolean {
  const msg = errorMessage(err);
  if (/provider returned error/i.test(msg)) return true;
  if (/"raw"\s*:\s*"ERROR"/i.test(msg)) return true;
  if (/\bmetadata\b[^}]*"provider_name"/i.test(msg) && /\b400\b/.test(msg)) return true;
  return false;
}

/**
 * OpenAI SDK HTTP 400 with an empty upstream body — common on managed inference /
 * OpenRouter when the reseller rejects a request without JSON details.
 */
export function isOpaqueInferenceProviderError(err: unknown): boolean {
  if (isOpenRouterUpstreamProviderError(err)) return false;
  const asApi = err as { status?: number; error?: unknown } | null;
  if (asApi?.status !== 400) return false;
  const msg = errorMessage(err).toLowerCase();
  if (/no body|status code \(no body\)/.test(msg)) return true;
  const errBody = asApi.error;
  return errBody === undefined || errBody === null || errBody === "";
}

/** Normalize OpenRouter provider slug from error metadata (case preserved). */
export function parseOpenRouterProviderSlug(err: unknown): string | null {
  const msg = errorMessage(err);

  const jsonName = msg.match(/provider_name["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (jsonName?.[1]?.trim()) return jsonName[1].trim();

  const fromProvider = msg.match(/\bfrom provider\s+([A-Za-z0-9][\w./+-]*)/i);
  if (fromProvider?.[1]?.trim()) return fromProvider[1].trim();

  const providerField = msg.match(/\bprovider["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (providerField?.[1]?.trim()) return providerField[1].trim();

  const providerIs = msg.match(/\bprovider\s+([A-Za-z0-9][\w./+-]*)\s+is\s+temporarily/i);
  if (providerIs?.[1]?.trim()) return providerIs[1].trim();

  // OpenRouter upstream throttle often names the reseller in prose.
  const upstream = msg.match(
    /(?:temporarily )?rate-?limited upstream[^.]*\b(DeepInfra|DeepSeek|Together|Fireworks|Novita|GMICloud|SiliconFlow|Hyperbolic|AtlasCloud|NCompass|Friendli|Chutes|Baidu|Qianfan|Stealth)\b/i
  );
  if (upstream?.[1]?.trim()) return upstream[1].trim();

  return null;
}
