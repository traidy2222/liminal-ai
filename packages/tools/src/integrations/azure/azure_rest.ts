/**
 * Azure Resource Manager REST client — OAuth or Azure CLI credentials.
 */
import {
  effectiveHarnessEnvRaw,
  getAzureAccessToken,
  tryAzCliArmAccessToken,
} from "@liminal/core";
import type { ToolResult } from "@liminal/core";

export const ARM_BASE = "https://management.azure.com";

export function azureRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_AZURE_REST") !== "0";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type AzureApiFetchInit = RequestInit & { accountId?: string; retries?: number };

export interface AzureApiFetchDeps {
  getToken: (accountId?: string) => Promise<string | null>;
  getCliToken: () => Promise<string | null>;
  fetchFn: typeof fetch;
  restEnabled: () => boolean;
}

async function resolveArmToken(
  deps: Pick<AzureApiFetchDeps, "getToken" | "getCliToken">,
  accountId?: string
): Promise<string | null> {
  const oauth = await deps.getToken(accountId);
  if (oauth) return oauth;
  return deps.getCliToken();
}

export async function azureApiFetchWithDeps(
  path: string,
  deps: AzureApiFetchDeps,
  init?: AzureApiFetchInit
): Promise<Response> {
  if (!deps.restEnabled()) {
    throw new Error("Azure REST tools are off (set AGENT_AZURE_REST=1).");
  }
  const token = await resolveArmToken(deps, init?.accountId);
  if (!token) {
    throw new Error(
      "No Azure ARM credentials. connect_provider({ provider: \"azure\", start_oauth: true }) or run `az login`."
    );
  }
  const url = path.startsWith("http") ? path : `${ARM_BASE}${path}`;
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

export async function azureApiFetch(path: string, init?: AzureApiFetchInit): Promise<Response> {
  return azureApiFetchWithDeps(
    path,
    {
      getToken: getAzureAccessToken,
      getCliToken: tryAzCliArmAccessToken,
      fetchFn: fetch,
      restEnabled: azureRestEnabled,
    },
    init
  );
}

export async function azureApiJson<T>(
  path: string,
  init?: RequestInit & { accountId?: string }
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await azureApiFetch(path, init);
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 800);
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        if (j.error?.message) detail = `${j.error.code ?? "error"}: ${j.error.message}`;
      } catch {
        /* use raw */
      }
      return { ok: false, error: `Azure ARM HTTP ${res.status}: ${detail}` };
    }
    if (!text.trim()) return { ok: true, data: {} as T };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function azureJsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

export function azureErrorResult(error: string): ToolResult {
  return { ok: false, error };
}
