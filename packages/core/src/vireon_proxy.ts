/**
 * Vireon managed-inference proxy response headers (upstream retry coordination).
 */

export const VIREON_UPSTREAM_RETRY_HEADER = "x-vireon-upstream-retries";

function readHeader(err: unknown, headerName: string): string | null {
  const asAny = err as { headers?: Record<string, string | string[] | undefined> } | null;
  const headers = asAny?.headers;
  if (!headers) return null;
  const lower = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

/** How many upstream OpenRouter attempts the Vireon proxy already made for this request. */
export function parseVireonUpstreamRetryCount(err: unknown): number {
  const raw = readHeader(err, VIREON_UPSTREAM_RETRY_HEADER);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when the managed proxy already retried upstream — harness should not duplicate 429 retries. */
export function vireonProxyAlreadyRetriedUpstream(err: unknown): boolean {
  return parseVireonUpstreamRetryCount(err) > 0;
}

export function managedUpstreamBusyMessage(): string {
  return "Managed inference providers are temporarily busy. Please try again shortly.";
}
