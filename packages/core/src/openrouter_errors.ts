/**
 * Parse OpenRouter / upstream error bodies for provider identification.
 */

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
