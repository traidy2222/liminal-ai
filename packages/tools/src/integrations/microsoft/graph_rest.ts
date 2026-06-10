/**
 * Shared Microsoft Graph REST client with token refresh and 429 retry.
 */
import { effectiveHarnessEnvRaw, getMicrosoftAccessToken } from "@liminal/core";
import type { ToolResult } from "@liminal/core";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function microsoftRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_MICROSOFT_REST") !== "0";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type GraphApiFetchInit = RequestInit & { accountId?: string; retries?: number };

export interface GraphApiFetchDeps {
  getToken: (accountId?: string) => Promise<string | null>;
  fetchFn: typeof fetch;
  restEnabled: () => boolean;
}

/** Injectable Graph fetch — used by graphApiFetch and unit tests. */
export async function graphApiFetchWithDeps(
  path: string,
  deps: GraphApiFetchDeps,
  init?: GraphApiFetchInit
): Promise<Response> {
  if (!deps.restEnabled()) {
    throw new Error("Microsoft REST tools are off (set AGENT_MICROSOFT_REST=1).");
  }
  const token = await deps.getToken(init?.accountId);
  if (!token) {
    throw new Error(
      "No Microsoft OAuth token. Connect via Settings → Integrations → Microsoft 365."
    );
  }
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const maxRetries = init?.retries ?? 3;
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await deps.fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body && !(init.headers as Record<string, string>)?.["Content-Type"]
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    lastRes = res;
    if (res.status !== 429 || attempt === maxRetries) return res;
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
  }
  return lastRes!;
}

export async function graphApiFetch(path: string, init?: GraphApiFetchInit): Promise<Response> {
  return graphApiFetchWithDeps(path, {
    getToken: getMicrosoftAccessToken,
    fetchFn: fetch,
    restEnabled: microsoftRestEnabled,
  }, init);
}

export async function graphApiJson<T>(
  path: string,
  init?: RequestInit & { accountId?: string }
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await graphApiFetch(path, init);
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        if (j.error?.message) detail = `${j.error.code ?? "error"}: ${j.error.message}`;
      } catch {
        /* use raw */
      }
      return { ok: false, error: `Graph API HTTP ${res.status}: ${detail}` };
    }
    if (!text.trim()) return { ok: true, data: {} as T };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function graphJsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

export function graphErrorResult(error: string): ToolResult {
  return { ok: false, error };
}
