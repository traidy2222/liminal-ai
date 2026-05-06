function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const secs = Number(headerValue);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const ts = Date.parse(headerValue);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, ts - Date.now());
}

function isRetryableNetworkError(err: unknown): boolean {
  const msg = String(err ?? "").toLowerCase();
  return /econnreset|econnrefused|etimedout|eai_again|socket|network|fetch failed|und_err_socket|aborted/.test(msg);
}

export interface RetryHttpConfig {
  timeoutMs: number;
  maxRetries?: number;
  maxDelayMs?: number;
}

export async function fetchWithRetry(url: string, init: RequestInit, cfg: RetryHttpConfig): Promise<Response> {
  const maxRetries = Math.max(0, cfg.maxRetries ?? Number(process.env["AGENT_WEB_FETCH_RETRIES"] ?? 6));
  const maxDelayMs = Math.max(1000, cfg.maxDelayMs ?? Number(process.env["AGENT_RETRY_MAX_DELAY_MS"] ?? 30_000));
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) return res;
        const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
        const exp = Math.min(10, attempt);
        const base = Math.min(maxDelayMs, Math.round(800 * Math.pow(2, exp)));
        const jitter = Math.round(Math.random() * base);
        await sleep(Math.max(250, Math.min(maxDelayMs, retryAfter ?? base + jitter)));
        attempt += 1;
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (!isRetryableNetworkError(err) || attempt >= maxRetries) {
        throw err;
      }
      const exp = Math.min(10, attempt);
      const base = Math.min(maxDelayMs, Math.round(600 * Math.pow(2, exp)));
      const jitter = Math.round(Math.random() * base);
      await sleep(Math.max(200, Math.min(maxDelayMs, base + jitter)));
      attempt += 1;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "fetch retry exhausted"));
}

