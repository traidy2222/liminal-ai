/**
 * Notion OAuth tokens (hosted handoff → ~/.liminal/oauth/notion/).
 */
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const accessCache = new Map<string, { token: string; expiresAt: number }>();

function notionOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.NOTION_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.NOTION_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_NOTION_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function persistNotionBundle(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
  bundle.updatedAt = Date.now();
  const { writeOAuthBundle } = await import("./oauth_store.js");
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

async function refreshNotionAccessToken(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  if (!bundle.refreshToken?.trim() || bundle.refreshToken === bundle.accessToken) {
    return null;
  }

  const cfg = notionOAuthClientConfig();
  if (cfg) {
    try {
      const res = await fetch(NOTION_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(cfg.clientId, cfg.clientSecret),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: bundle.refreshToken,
        }),
      });
      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };
      if (res.ok && !json.error && json.access_token) {
        bundle.accessToken = json.access_token;
        if (json.refresh_token) bundle.refreshToken = json.refresh_token;
        bundle.expiresAt = Date.now() + FAR_FUTURE_MS;
        return persistNotionBundle(bundle);
      }
    } catch {
      /* try hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker("notion", bundle.refreshToken);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) bundle.scopes = hosted.scopes;
  return persistNotionBundle(bundle);
}

export async function getNotionAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("notion", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("notion");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshNotionAccessToken(bundle);
  if (refreshed?.accessToken) return refreshed.accessToken;
  if (bundle.accessToken) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }
  return null;
}

export async function revokeNotionAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("notion", accountId);
  accessCache.delete(accountId);
  if (bundle?.accessToken) {
    const cfg = notionOAuthClientConfig();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg) {
        headers.Authorization = basicAuthHeader(cfg.clientId, cfg.clientSecret);
      }
      await fetch(NOTION_REVOKE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ token: bundle.accessToken }),
      });
    } catch {
      /* local delete still proceeds */
    }
  }
  await deleteOAuthBundle("notion", accountId);
}

export async function listNotionOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    workspaceName?: string;
    workspaceId?: string;
  }>
> {
  const accounts = await listOAuthAccounts("notion");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    workspaceName:
      typeof a.metadata?.workspaceName === "string" ? a.metadata.workspaceName : undefined,
    workspaceId: typeof a.metadata?.workspaceId === "string" ? a.metadata.workspaceId : undefined,
  }));
}

export function notionWorkspaceIdFromBundle(bundle: OAuthTokenBundle): string | undefined {
  const id = bundle.metadata?.workspaceId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}
