/**
 * Parse OpenRouter / upstream error bodies for provider identification.
 */

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Normalize OpenRouter provider slug from error metadata (case preserved). */
export function parseOpenRouterProviderSlug(err: unknown): string | null {
  const msg = describeError(err);

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
