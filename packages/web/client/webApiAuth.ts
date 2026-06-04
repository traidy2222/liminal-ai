/** Local web API bearer token — injected in HTML or from GET /api/config (loopback bootstrap). */
let webAuthToken: string | null = null;
let authReadyPromise: Promise<boolean> | null = null;

function readInjectedWebAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector('meta[name="liminal-web-auth"]');
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta;
  return null;
}

const injectedAtLoad = readInjectedWebAuthToken();
if (injectedAtLoad) {
  webAuthToken = injectedAtLoad;
}

export function setWebAuthToken(token: string | null): void {
  webAuthToken = token?.trim() || null;
}

export function getWebAuthToken(): string | null {
  return webAuthToken;
}

export function webApiAuthHeaders(): Record<string, string> {
  if (!webAuthToken) return {};
  return {
    Authorization: `Bearer ${webAuthToken}`,
    "X-Liminal-Token": webAuthToken,
  };
}

/**
 * Resolve the web auth token before any protected API call.
 * Reads server-injected HTML meta first, then falls back to GET /api/config.
 */
export async function ensureWebAuthReady(): Promise<boolean> {
  if (webAuthToken) return true;
  const injected = readInjectedWebAuthToken();
  if (injected) {
    setWebAuthToken(injected);
    return true;
  }
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      try {
        const r = await fetch("/api/config");
        if (!r.ok) return false;
        const cfg = (await r.json()) as { webAuthToken?: string };
        if (typeof cfg.webAuthToken === "string" && cfg.webAuthToken.trim()) {
          setWebAuthToken(cfg.webAuthToken.trim());
          return true;
        }
        return false;
      } catch {
        return false;
      }
    })();
  }
  return authReadyPromise;
}

/** Authenticated fetch for Liminal web API routes. */
export async function webApiFetch(url: string, init?: RequestInit): Promise<Response> {
  await ensureWebAuthReady();
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(webApiAuthHeaders())) {
    headers.set(k, v);
  }
  return fetch(url, { ...init, headers });
}

export function webApiStreamUrl(basePath: string): string {
  if (!webAuthToken) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}authToken=${encodeURIComponent(webAuthToken)}`;
}
