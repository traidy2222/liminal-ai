/** Local web API bearer token from GET /api/config (loopback bootstrap). */
let webAuthToken: string | null = null;

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

/** Authenticated fetch for Liminal web API routes. */
export function webApiFetch(url: string, init?: RequestInit): Promise<Response> {
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
