/**
 * Linear OAuth tokens (hosted handoff → ~/.liminal/oauth/linear/).
 */
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const accessCache = new Map<string, { token: string; expiresAt: number }>();

function linearOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.LINEAR_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_LINEAR_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.LINEAR_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_LINEAR_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function persistLinearRefresh(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
  bundle.updatedAt = Date.now();
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

async function refreshLinearAccessToken(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  if (!bundle.refreshToken?.trim()) return null;

  const cfg = linearOAuthClientConfig();
  if (cfg && bundle.refreshToken !== bundle.accessToken) {
    try {
      const res = await fetch(LINEAR_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: bundle.refreshToken,
        }).toString(),
      });
      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };
      if (res.ok && !json.error && json.access_token) {
        bundle.accessToken = json.access_token;
        if (json.refresh_token) bundle.refreshToken = json.refresh_token;
        bundle.expiresAt =
          json.expires_in != null ? Date.now() + json.expires_in * 1000 - 60_000 : Date.now() + FAR_FUTURE_MS;
        return persistLinearRefresh(bundle);
      }
    } catch {
      /* try hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker("linear", bundle.refreshToken);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) bundle.scopes = hosted.scopes;
  return persistLinearRefresh(bundle);
}

export async function getLinearAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("linear", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("linear");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshLinearAccessToken(bundle);
  if (refreshed?.accessToken) return refreshed.accessToken;
  if (Date.now() < bundle.expiresAt - 30_000) return bundle.accessToken;
  return null;
}

export async function revokeLinearAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("linear", accountId);
  accessCache.delete(accountId);
  if (bundle?.accessToken) {
    try {
      await fetch(LINEAR_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: bundle.accessToken }).toString(),
      });
    } catch {
      /* local delete still proceeds */
    }
  }
  await deleteOAuthBundle("linear", accountId);
}

export async function listLinearOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    organizationName?: string;
  }>
> {
  const accounts = await listOAuthAccounts("linear");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    organizationName:
      typeof a.metadata?.organizationName === "string" ? a.metadata.organizationName : undefined,
  }));
}
