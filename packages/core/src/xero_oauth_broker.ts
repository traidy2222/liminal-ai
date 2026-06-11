/**
 * Xero OAuth 2.0 — authorization URL, code exchange, refresh, tenant connections.
 */
import { pickBestOAuthAccountByEmail } from "./oauth_account_pick.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";
import { scopesForXeroMode, type XeroMode, XERO_DEFAULT_MODE } from "./xero_oauth_scopes.js";
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";

const accessCache = new Map<string, { token: string; expiresAt: number }>();

export type XeroTenantConnection = {
  tenantId: string;
  tenantName?: string;
  tenantType?: string;
};

export function xeroOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.XERO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.XERO_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postXeroToken(
  body: URLSearchParams,
  cfg?: { clientId: string; clientSecret: string }
): Promise<TokenResponse> {
  const resolved = cfg ?? xeroOAuthClientConfig();
  if (!resolved) throw new Error("Xero OAuth client not configured");
  const auth = Buffer.from(`${resolved.clientId}:${resolved.clientSecret}`).toString("base64");
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `Xero token HTTP ${res.status}`);
  }
  return json;
}

function parseIdTokenEmail(idToken?: string): string | undefined {
  if (!idToken?.trim()) return undefined;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return json.email?.trim() || json.preferred_username?.trim();
  } catch {
    return undefined;
  }
}

export function buildXeroAuthUrl(opts: {
  redirectUri: string;
  scopes: string[];
  state: string;
  clientId?: string;
}): string {
  const clientId = opts.clientId?.trim() || xeroOAuthClientConfig()?.clientId;
  if (!clientId) throw new Error("XERO_OAUTH_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(" "),
    state: opts.state,
  });
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

export async function fetchXeroConnections(accessToken: string): Promise<XeroTenantConnection[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Xero connections HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const rows = (await res.json()) as Array<{
    tenantId?: string;
    tenantName?: string;
    tenantType?: string;
  }>;
  return rows
    .map((r) => ({
      tenantId: r.tenantId?.trim() ?? "",
      tenantName: r.tenantName?.trim(),
      tenantType: r.tenantType?.trim(),
    }))
    .filter((r) => r.tenantId);
}

export async function exchangeXeroCode(opts: {
  code: string;
  redirectUri: string;
  scopes: string[];
  mode?: XeroMode;
  clientConfig?: { clientId: string; clientSecret: string };
}): Promise<OAuthTokenBundle> {
  const mode = opts.mode ?? XERO_DEFAULT_MODE;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  const tok = await postXeroToken(body, opts.clientConfig);
  if (!tok.access_token) throw new Error("no access_token in Xero response");
  const email = parseIdTokenEmail(tok.id_token);
  const accountId = sanitizeOAuthAccountId(email ?? "default");
  const connections = await fetchXeroConnections(tok.access_token);
  const primary = connections[0];
  const expiresAt = Date.now() + (tok.expires_in ?? 1800) * 1000 - 60_000;
  const grantedScopes = tok.scope?.split(" ").filter(Boolean) ?? opts.scopes;
  const existing = await readOAuthBundle("xero", accountId);
  const bundle: OAuthTokenBundle = {
    provider: "xero",
    accountId,
    email,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? existing?.refreshToken ?? "",
    expiresAt,
    scopes: grantedScopes,
    metadata: {
      mode,
      tenantId: primary?.tenantId,
      tenantName: primary?.tenantName,
      tenants: connections,
    },
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (!bundle.refreshToken) {
    throw new Error("no refresh_token — revoke Liminal in Xero connected apps and reconnect");
  }
  await writeOAuthBundle(bundle);
  accessCache.set(accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function refreshXeroAccessToken(accountId?: string): Promise<OAuthTokenBundle | null> {
  const bundle = await readOAuthBundle("xero", accountId);
  if (!bundle?.refreshToken) return null;

  if (xeroOAuthClientConfig()) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: bundle.refreshToken,
      });
      const tok = await postXeroToken(body);
      if (tok.access_token) {
        bundle.accessToken = tok.access_token;
        bundle.expiresAt = Date.now() + (tok.expires_in ?? 1800) * 1000 - 60_000;
        if (tok.refresh_token) bundle.refreshToken = tok.refresh_token;
        if (tok.scope) bundle.scopes = tok.scope.split(" ").filter(Boolean);
        bundle.updatedAt = Date.now();
        await writeOAuthBundle(bundle);
        accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
        return bundle;
      }
    } catch {
      /* try hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker("xero", bundle.refreshToken);
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

export async function getXeroAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("xero", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("xero");
    bundle = pickBestOAuthAccountByEmail(accounts) ?? accounts[0] ?? null;
  }
  if (!bundle) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshXeroAccessToken(bundle.accountId);
  return refreshed?.accessToken ?? null;
}

export function resolveXeroTenantId(
  bundle: OAuthTokenBundle,
  tenantIdHint?: string
): string | undefined {
  const hint = tenantIdHint?.trim();
  if (hint) return hint;
  const meta = bundle.metadata as { tenantId?: string; tenants?: XeroTenantConnection[] } | undefined;
  if (meta?.tenantId?.trim()) return meta.tenantId.trim();
  const first = meta?.tenants?.[0]?.tenantId;
  return first?.trim() || undefined;
}

export async function revokeXeroAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("xero", accountId);
  if (bundle?.refreshToken) {
    try {
      const cfg = xeroOAuthClientConfig();
      if (cfg) {
        const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
        await fetch(XERO_REVOKE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${auth}`,
          },
          body: new URLSearchParams({ token: bundle.refreshToken }).toString(),
        });
      }
    } catch {
      /* best effort */
    }
  }
  accessCache.delete(accountId);
  await deleteOAuthBundle("xero", accountId);
}

/** Refresh any Xero accounts whose access token expires within `withinMs` (default 5 min). */
export async function refreshStaleXeroAccounts(withinMs = 5 * 60_000): Promise<void> {
  const accounts = await listOAuthAccounts("xero");
  const threshold = Date.now() + withinMs;
  for (const a of accounts) {
    if (a.expiresAt < threshold) {
      await refreshXeroAccessToken(a.accountId).catch(() => { /* non-fatal */ });
    }
  }
}

export async function listXeroOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    tenantId?: string;
    tenantName?: string;
  }>
> {
  const accounts = await listOAuthAccounts("xero");
  return accounts.map((a) => {
    const meta = a.metadata as { tenantId?: string; tenantName?: string } | undefined;
    return {
      accountId: a.accountId,
      email: a.email,
      scopes: a.scopes,
      expiresAt: a.expiresAt,
      tenantId: meta?.tenantId,
      tenantName: meta?.tenantName,
    };
  });
}

export { scopesForXeroMode, type XeroMode, XERO_DEFAULT_MODE };
