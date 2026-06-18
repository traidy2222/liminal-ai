/**
 * YouTube channel OAuth — Google token endpoints, separate `youtube` provider store.
 */
import { googleOAuthClientConfig } from "./oauth_broker.js";
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";
import { pickBestOAuthAccountByEmail } from "./oauth_account_pick.js";
import { fetchPrimaryYoutubeChannel } from "./youtube_channel.js";
import { scopesForYoutubeMode, type YoutubeConnectMode } from "./youtube_oauth_scopes.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const PROVIDER = "youtube";

const accessCache = new Map<string, { token: string; expiresAt: number }>();

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postGoogleToken(body: URLSearchParams): Promise<TokenResponse> {
  const cfg = googleOAuthClientConfig();
  if (!cfg) throw new Error("Google OAuth client not configured");
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `token HTTP ${res.status}`);
  }
  return json;
}

async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email?.trim();
  } catch {
    return undefined;
  }
}

export async function enrichYoutubeBundleChannel(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
  const channel = await fetchPrimaryYoutubeChannel(bundle.accessToken);
  if (!channel) return bundle;
  const metadata = {
    ...(bundle.metadata ?? {}),
    channelId: channel.channelId,
    channelTitle: channel.title,
    customUrl: channel.customUrl,
    thumbnailUrl: channel.thumbnailUrl,
  };
  const updated: OAuthTokenBundle = { ...bundle, metadata, updatedAt: Date.now() };
  await writeOAuthBundle(updated);
  return updated;
}

export async function writeYoutubeOAuthBundle(input: {
  accountId: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  metadata?: Record<string, unknown>;
}): Promise<OAuthTokenBundle> {
  const accountId = sanitizeOAuthAccountId(input.accountId);
  const existing = await readOAuthBundle(PROVIDER, accountId);
  let bundle: OAuthTokenBundle = {
    provider: PROVIDER,
    accountId,
    email: input.email,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    scopes: input.scopes,
    metadata: input.metadata,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (!bundle.metadata?.channelId) {
    bundle = await enrichYoutubeBundleChannel(bundle);
  } else {
    await writeOAuthBundle(bundle);
  }
  accessCache.set(accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function refreshYoutubeAccessToken(accountId?: string): Promise<OAuthTokenBundle | null> {
  const bundle = await readOAuthBundle(PROVIDER, accountId);
  if (!bundle?.refreshToken) return null;

  if (googleOAuthClientConfig()) {
    try {
      const body = new URLSearchParams({
        refresh_token: bundle.refreshToken,
        grant_type: "refresh_token",
      });
      const tok = await postGoogleToken(body);
      if (tok.access_token) {
        bundle.accessToken = tok.access_token;
        bundle.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000;
        if (tok.scope) bundle.scopes = tok.scope.split(" ").filter(Boolean);
        bundle.updatedAt = Date.now();
        await writeOAuthBundle(bundle);
        accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
        return bundle;
      }
    } catch {
      /* hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker(PROVIDER, bundle.refreshToken);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) bundle.scopes = hosted.scopes;
  bundle.updatedAt = Date.now();
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function getYoutubeAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle(PROVIDER, id);
  if (!bundle) {
    const accounts = await listOAuthAccounts(PROVIDER);
    bundle = pickBestOAuthAccountByEmail(accounts) ?? accounts[0] ?? null;
  }
  if (!bundle) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshYoutubeAccessToken(bundle.accountId);
  return refreshed?.accessToken ?? null;
}

export async function revokeYoutubeAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle(PROVIDER, accountId);
  if (bundle?.accessToken) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(bundle.refreshToken || bundle.accessToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      /* best effort */
    }
  }
  accessCache.delete(accountId);
  await deleteOAuthBundle(PROVIDER, accountId);
}

export async function listYoutubeOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    channelId?: string;
    channelTitle?: string;
    customUrl?: string;
    connectMode?: YoutubeConnectMode;
    monetaryRequested?: boolean;
  }>
> {
  const accounts = await listOAuthAccounts(PROVIDER);
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    channelId: typeof a.metadata?.channelId === "string" ? a.metadata.channelId : undefined,
    channelTitle: typeof a.metadata?.channelTitle === "string" ? a.metadata.channelTitle : undefined,
    customUrl: typeof a.metadata?.customUrl === "string" ? a.metadata.customUrl : undefined,
    connectMode:
      a.metadata?.mode === "read_only" || a.metadata?.mode === "read_write"
        ? a.metadata.mode
        : undefined,
    monetaryRequested: a.metadata?.monetary !== false,
  }));
}

export async function ensureYoutubeOAuthBundle(
  mode: YoutubeConnectMode = "read_write"
): Promise<OAuthTokenBundle | null> {
  const accounts = await listOAuthAccounts(PROVIDER);
  const bundle = pickBestOAuthAccountByEmail(accounts) ?? accounts[0] ?? null;
  if (!bundle) return null;
  if (!bundle.metadata?.channelId) {
    return enrichYoutubeBundleChannel(bundle);
  }
  return bundle;
}

export { scopesForYoutubeMode };
