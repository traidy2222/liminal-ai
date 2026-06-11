/**
 * Azure Resource Manager REST client — OAuth or Azure CLI credentials.
 * @see https://learn.microsoft.com/en-us/rest/api/azure/
 */
import {
  effectiveHarnessEnvRaw,
  getAzureAccessToken,
  refreshAzureAccessToken,
  tryAzCliArmAccessToken,
} from "@liminal/core";
import type { ToolResult } from "@liminal/core";
import { buildArmUrl } from "./azure_arm_api.js";

export const ARM_BASE = "https://management.azure.com";

export function azureRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_AZURE_REST") !== "0";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type AzureApiFetchInit = RequestInit & {
  accountId?: string;
  retries?: number;
  apiVersion?: string;
};

export interface AzureApiFetchDeps {
  getToken: (accountId?: string) => Promise<string | null>;
  getCliToken: () => Promise<string | null>;
  refreshToken?: (accountId?: string) => Promise<string | null>;
  fetchFn: typeof fetch;
  restEnabled: () => boolean;
}

async function resolveArmToken(
  deps: Pick<AzureApiFetchDeps, "getToken" | "getCliToken">,
  accountId?: string
): Promise<{ token: string; source: "oauth" | "az_cli" } | null> {
  const oauth = await deps.getToken(accountId);
  if (oauth) return { token: oauth, source: "oauth" };
  const cli = await deps.getCliToken();
  if (cli) return { token: cli, source: "az_cli" };
  return null;
}

function formatFetchError(e: unknown, url: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(msg)) {
    return (
      `Azure ARM request failed before HTTP response (${msg}). ` +
      `URL: ${url}. Check network/DNS and that the path starts with / (e.g. /subscriptions?api-version=2022-12-01).`
    );
  }
  return msg;
}

export async function azureApiFetchWithDeps(
  path: string,
  deps: AzureApiFetchDeps,
  init?: AzureApiFetchInit
): Promise<Response> {
  if (!deps.restEnabled()) {
    throw new Error("Azure REST tools are off (set AGENT_AZURE_REST=1).");
  }

  const url = buildArmUrl(path, init?.apiVersion);
  const maxRetries = init?.retries ?? 3;
  let cred = await resolveArmToken(deps, init?.accountId);
  if (!cred) {
    throw new Error(
      "No Azure ARM credentials. connect_provider({ provider: \"azure\", start_oauth: true }) " +
        "(needs Azure Service Management user_impersonation) or run `az login`."
    );
  }

  let lastRes: Response | null = null;
  let refreshed401 = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await deps.fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${cred.token}`,
          Accept: "application/json",
          "User-Agent": "liminal-harness/1.0",
          ...(init?.body && !(init.headers as Record<string, string>)?.["Content-Type"]
            ? { "Content-Type": "application/json" }
            : {}),
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      lastRes = res;

      if (res.status === 401 && cred.source === "oauth" && !refreshed401 && deps.refreshToken) {
        const next = await deps.refreshToken(init?.accountId);
        if (next) {
          cred = { token: next, source: "oauth" };
          refreshed401 = true;
          continue;
        }
      }

      if (res.status === 401 && cred.source === "oauth") {
        const cli = await deps.getCliToken();
        if (cli) {
          cred = { token: cli, source: "az_cli" };
          continue;
        }
      }

      if (res.status !== 429 || attempt === maxRetries) return res;
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
    } catch (e) {
      throw new Error(formatFetchError(e, url));
    }
  }
  return lastRes!;
}

export async function azureApiFetch(path: string, init?: AzureApiFetchInit): Promise<Response> {
  return azureApiFetchWithDeps(
    path,
    {
      getToken: getAzureAccessToken,
      getCliToken: tryAzCliArmAccessToken,
      refreshToken: async (accountId) => {
        const bundle = await refreshAzureAccessToken(accountId);
        return bundle?.accessToken ?? null;
      },
      fetchFn: fetch,
      restEnabled: azureRestEnabled,
    },
    init
  );
}

export async function azureApiJson<T>(
  path: string,
  init?: AzureApiFetchInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  try {
    const res = await azureApiFetch(path, init);
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 1200);
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        if (j.error?.message) detail = `${j.error.code ?? "error"}: ${j.error.message}`;
      } catch {
        /* use raw */
      }
      if (res.status === 401) {
        detail +=
          " — token may lack https://management.azure.com/user_impersonation. Reconnect Azure OAuth or run `az login`.";
      }
      if (res.status === 400 && detail.includes("api-version")) {
        detail += " — include a valid api-version query param or use azure_get_provider_api_versions.";
      }
      return { ok: false, error: `Azure ARM HTTP ${res.status}: ${detail}`, status: res.status };
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
