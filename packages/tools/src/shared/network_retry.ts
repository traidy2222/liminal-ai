import { effectiveHarnessEnvRaw } from "@liminal/core";

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    abortSignal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
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
  return (
    /econnreset|econnrefused|etimedout|eai_again|socket|network|fetch failed|und_err_socket|aborted/.test(msg) ||
    /cert_|unable_to_verify|ssl handshake|tlsv1_alert|openssl|x509|wrong version number/.test(msg)
  );
}

export interface RetryHttpConfig {
  timeoutMs: number;
  maxRetries?: number;
  maxDelayMs?: number;
  /** When aborted, in-flight fetch is cancelled (e.g. overall web_fetch wall budget). */
  externalSignal?: AbortSignal;
  /**
   * When true, keep the per-attempt abort timer running after headers arrive so the same
   * `timeoutMs` budget covers the response body read (fetch undici obeys signal on body).
   * Default false: timer clears at first byte of response (legacy behavior for short API calls).
   */
  tieTimeoutToFullDownload?: boolean;
  /** Test hook — override global fetch. */
  fetchImpl?: typeof fetch;
}

export async function fetchWithRetry(url: string, init: RequestInit, cfg: RetryHttpConfig): Promise<Response> {
  const maxRetries = Math.max(0, cfg.maxRetries ?? Number(effectiveHarnessEnvRaw("AGENT_WEB_FETCH_RETRIES") ?? "2"));
  const maxDelayMs = Math.max(1000, cfg.maxDelayMs ?? Number(effectiveHarnessEnvRaw("AGENT_RETRY_MAX_DELAY_MS") ?? "30000"));
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= maxRetries) {
    if (cfg.externalSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const signals: AbortSignal[] = [controller.signal];
    if (cfg.externalSignal) signals.push(cfg.externalSignal);
    if (init.signal) signals.push(init.signal);
    const reqSignal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
    try {
      const doFetch = cfg.fetchImpl ?? fetch;
      const res = await doFetch(url, { ...init, signal: reqSignal });
      const tie = cfg.tieTimeoutToFullDownload === true;
      if (res.status === 429 || res.status >= 500) {
        clearTimeout(timeout);
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        if (attempt >= maxRetries) return res;
        const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
        const exp = Math.min(10, attempt);
        const base = Math.min(maxDelayMs, Math.round(800 * Math.pow(2, exp)));
        const jitter = Math.round(Math.random() * base);
        await sleep(Math.max(250, Math.min(maxDelayMs, retryAfter ?? base + jitter)), cfg.externalSignal);
        if (cfg.externalSignal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        attempt += 1;
        continue;
      }
      if (!tie) clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (cfg.externalSignal?.aborted) {
        throw err;
      }
      if (!isRetryableNetworkError(err) || attempt >= maxRetries) {
        throw err;
      }
      const exp = Math.min(10, attempt);
      const base = Math.min(maxDelayMs, Math.round(600 * Math.pow(2, exp)));
      const jitter = Math.round(Math.random() * base);
      await sleep(Math.max(200, Math.min(maxDelayMs, base + jitter)), cfg.externalSignal);
      if (cfg.externalSignal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      attempt += 1;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "fetch retry exhausted"));
}

