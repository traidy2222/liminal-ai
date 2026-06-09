/**
 * Slack user OAuth — direct loopback (client id in .env) or hosted handoff tokens.
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
import { scopesForSlackMode, type SlackMode, SLACK_DEFAULT_MODE } from "./slack_oauth_scopes.js";

const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_API = "https://slack.com/api";
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const accessCache = new Map<string, { token: string; expiresAt: number }>();

export function slackOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.SLACK_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_SLACK_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.SLACK_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_SLACK_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function parseScopeList(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type SlackOauthV2Response = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  authed_user?: {
    id?: string;
    scope?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  team?: { id?: string; name?: string };
};

async function postSlackToken(
  body: URLSearchParams,
  cfg?: { clientId: string; clientSecret: string }
): Promise<SlackOauthV2Response> {
  const resolved = cfg ?? slackOAuthClientConfig();
  if (!resolved) throw new Error("Slack OAuth client not configured");
  body.set("client_id", resolved.clientId);
  body.set("client_secret", resolved.clientSecret);
  const res = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as SlackOauthV2Response;
  if (!res.ok || json.ok === false || json.error) {
    throw new Error(json.error ?? `Slack token HTTP ${res.status}`);
  }
  return json;
}

/** Slack user tokens require `user_scope` on authorize — not `scope` (bot). */
export function buildSlackAuthUrl(opts: {
  redirectUri: string;
  userScopes: string[];
  state: string;
  clientId?: string;
}): string {
  const clientId = opts.clientId?.trim() || slackOAuthClientConfig()?.clientId;
  if (!clientId) throw new Error("SLACK_OAUTH_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: opts.userScopes.join(","),
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

export async function fetchSlackUserTokenScopes(accessToken: string): Promise<string[]> {
  const res = await fetch(`${SLACK_API}/auth.scopes.list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams({ token: accessToken }).toString(),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    info?: Array<{ type?: string; scopes?: string[] }>;
  };
  if (!data.ok) throw new Error(data.error ?? `auth.scopes.list HTTP ${res.status}`);
  const userInfo = data.info?.find((i) => i.type === "user") ?? data.info?.[0];
  return userInfo?.scopes ?? [];
}

/** Refresh bundle.scopes from live token (fixes empty/wrong scopes after hosted handoff). */
export async function syncSlackBundleScopes(accountId?: string): Promise<string[]> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  let bundle = await readOAuthBundle("slack", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("slack");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return [];
  const live = await fetchSlackUserTokenScopes(bundle.accessToken);
  if (live.length > 0 && live.join(",") !== bundle.scopes.join(",")) {
    bundle.scopes = live;
    bundle.updatedAt = Date.now();
    await writeOAuthBundle(bundle);
  }
  return live.length > 0 ? live : bundle.scopes;
}

function bundleFromSlackOauthResponse(
  json: SlackOauthV2Response,
  mode: SlackMode
): OAuthTokenBundle {
  const user = json.authed_user;
  if (!user?.access_token?.trim()) {
    throw new Error(
      "Slack returned no user token — authorize URL must include user_scope (not bot scope only)"
    );
  }
  const userToken = user.access_token.trim();
  const teamId = json.team?.id?.trim() ?? "default";
  const accountId = sanitizeOAuthAccountId(teamId);
  const scopes = parseScopeList(user.scope);
  const expiresIn = user.expires_in ?? json.expires_in;
  const expiresAt =
    expiresIn != null ? Date.now() + expiresIn * 1000 - 60_000 : Date.now() + FAR_FUTURE_MS;
  return {
    provider: "slack",
    accountId,
    accessToken: userToken,
    refreshToken: user.refresh_token?.trim() ?? json.refresh_token?.trim() ?? "",
    expiresAt,
    scopes: scopes.length > 0 ? scopes : scopesForSlackMode(mode),
    metadata: {
      teamId: json.team?.id,
      teamName: json.team?.name,
      slackUserId: user.id,
      mode,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function exchangeSlackCode(opts: {
  code: string;
  redirectUri: string;
  mode?: SlackMode;
}): Promise<OAuthTokenBundle> {
  const mode = opts.mode ?? SLACK_DEFAULT_MODE;
  const body = new URLSearchParams({
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  const json = await postSlackToken(body);
  const fresh = bundleFromSlackOauthResponse(json, mode);
  const existing = await readOAuthBundle("slack", fresh.accountId);
  const bundle: OAuthTokenBundle = {
    ...fresh,
    refreshToken: fresh.refreshToken || existing?.refreshToken || "",
    createdAt: existing?.createdAt ?? fresh.createdAt,
  };
  if (!bundle.refreshToken) {
    bundle.expiresAt = Date.now() + FAR_FUTURE_MS;
  }
  try {
    const live = await fetchSlackUserTokenScopes(bundle.accessToken);
    if (live.length > 0) bundle.scopes = live;
  } catch {
    /* keep exchange scopes */
  }
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

async function persistSlackRefresh(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
  bundle.updatedAt = Date.now();
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

async function refreshSlackAccessToken(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  const rt = bundle.refreshToken?.trim();
  if (!rt) return null;

  const cfg = slackOAuthClientConfig();
  if (cfg) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: rt,
      });
      const json = await postSlackToken(body, cfg);
      const user = json.authed_user;
      if (user?.access_token) {
        bundle.accessToken = user.access_token;
        if (user.refresh_token) bundle.refreshToken = user.refresh_token;
        const scopes = parseScopeList(user.scope);
        if (scopes.length > 0) bundle.scopes = scopes;
        const expiresIn = user.expires_in ?? json.expires_in;
        bundle.expiresAt =
          expiresIn != null ? Date.now() + expiresIn * 1000 - 60_000 : Date.now() + FAR_FUTURE_MS;
        return persistSlackRefresh(bundle);
      }
    } catch {
      /* try hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker("slack", rt);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) bundle.scopes = hosted.scopes;
  return persistSlackRefresh(bundle);
}

export async function getSlackAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("slack", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("slack");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return null;

  if (Date.now() >= bundle.expiresAt - 30_000) {
    const refreshed = await refreshSlackAccessToken(bundle);
    if (refreshed?.accessToken) return refreshed.accessToken;
    if (Date.now() >= bundle.expiresAt) return null;
  }

  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle.accessToken;
}

export async function revokeSlackAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("slack", accountId);
  accessCache.delete(accountId);
  if (bundle?.accessToken) {
    try {
      await fetch(`${SLACK_API}/auth.revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${bundle.accessToken}`,
        },
        body: new URLSearchParams({ token: bundle.accessToken }).toString(),
      });
    } catch {
      /* local delete still proceeds */
    }
  }
  await deleteOAuthBundle("slack", accountId);
}

export async function listSlackOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    teamName?: string;
    teamId?: string;
  }>
> {
  const accounts = await listOAuthAccounts("slack");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    teamName: typeof a.metadata?.teamName === "string" ? a.metadata.teamName : undefined,
    teamId: typeof a.metadata?.teamId === "string" ? a.metadata.teamId : undefined,
  }));
}

export function slackTeamIdFromBundle(bundle: OAuthTokenBundle): string | undefined {
  const id = bundle.metadata?.teamId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}
