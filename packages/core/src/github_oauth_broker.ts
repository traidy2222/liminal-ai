/**
 * GitHub OAuth token read / refresh / revoke (tokens obtained via hosted handoff).
 */
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

const accessCache = new Map<string, { token: string; expiresAt: number }>();

/** Non-expiring GitHub tokens — treat as valid for ~10 years when no expires_in. */
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function githubOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.GITHUB_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_GITHUB_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId) return null;
  return { clientId, clientSecret };
}

async function refreshGithubAccessToken(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  const cfg = githubOAuthClientConfig();
  if (!cfg?.clientSecret || !bundle.refreshToken || bundle.refreshToken === bundle.accessToken) {
    return null;
  }
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "refresh_token",
        refresh_token: bundle.refreshToken,
      }).toString(),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || json.error || !json.access_token) return null;
    bundle.accessToken = json.access_token;
    if (json.refresh_token) bundle.refreshToken = json.refresh_token;
    bundle.expiresAt =
      json.expires_in != null
        ? Date.now() + json.expires_in * 1000 - 60_000
        : Date.now() + FAR_FUTURE_MS;
    bundle.updatedAt = Date.now();
    await writeOAuthBundle(bundle);
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle;
  } catch {
    return null;
  }
}

export async function getGithubAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("github", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("github");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshGithubAccessToken(bundle);
  return refreshed?.accessToken ?? bundle.accessToken;
}

export async function revokeGithubAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("github", accountId);
  accessCache.delete(accountId);
  if (bundle?.accessToken) {
    const cfg = githubOAuthClientConfig();
    if (cfg?.clientSecret) {
      try {
        const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
        await fetch(`https://api.github.com/applications/${cfg.clientId}/token`, {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: bundle.accessToken }),
        });
      } catch {
        /* local delete still proceeds */
      }
    }
  }
  await deleteOAuthBundle("github", accountId);
}

export async function listGithubOAuthAccounts(): Promise<
  Array<{ accountId: string; email?: string; scopes: string[]; expiresAt: number; login?: string }>
> {
  const accounts = await listOAuthAccounts("github");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    login: typeof a.metadata?.login === "string" ? a.metadata.login : undefined,
  }));
}
