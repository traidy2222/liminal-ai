/**
 * Microsoft Entra ID OAuth 2.0 — authorization URL, code exchange, refresh, access token.
 */
import { normalizeMicrosoftScopes } from "./microsoft_oauth_scopes.js";
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

function mergeMicrosoftGrantedScopes(existing: string[], incoming: string[]): string[] {
  return normalizeMicrosoftScopes([...existing, ...incoming]);
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

export function microsoftTenantId(): string {
  return (
    process.env.MICROSOFT_TENANT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_TENANT_ID?.trim() ||
    "common"
  );
}

export function microsoftOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId) return null;
  return { clientId, clientSecret };
}

function authBaseUrl(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenantId())}/oauth2/v2.0`;
}

export function buildMicrosoftAuthUrl(opts: {
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const cfg = microsoftOAuthClientConfig();
  if (!cfg) {
    throw new Error(
      "MICROSOFT_OAUTH_CLIENT_ID must be set in .env (see docs/guides/microsoft-365.md)"
    );
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    response_mode: "query",
    prompt: "consent",
  });
  return `${authBaseUrl()}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const cfg = microsoftOAuthClientConfig();
  if (!cfg) throw new Error("Microsoft OAuth client not configured");
  body.set("client_id", cfg.clientId);
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  const res = await fetch(`${authBaseUrl()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    const desc = json.error_description ?? json.error ?? `token HTTP ${res.status}`;
    throw new Error(desc);
  }
  return json;
}

async function fetchMicrosoftEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { mail?: string; userPrincipalName?: string };
    return data.mail?.trim() || data.userPrincipalName?.trim();
  } catch {
    return undefined;
  }
}

export async function exchangeMicrosoftCode(opts: {
  code: string;
  redirectUri: string;
  scopes: string[];
}): Promise<OAuthTokenBundle> {
  const body = new URLSearchParams({
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const tok = await postToken(body);
  if (!tok.access_token) throw new Error("no access_token in response");
  const email = await fetchMicrosoftEmail(tok.access_token);
  const accountId = sanitizeOAuthAccountId(email ?? "default");
  const expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000;
  const grantedScopes = mergeMicrosoftGrantedScopes(
    [],
    tok.scope?.split(" ").filter(Boolean) ?? opts.scopes
  );
  const existing = await readOAuthBundle("microsoft", accountId);
  const bundle: OAuthTokenBundle = {
    provider: "microsoft",
    accountId,
    email,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? existing?.refreshToken ?? "",
    expiresAt,
    scopes: grantedScopes,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (!bundle.refreshToken) {
    throw new Error(
      "no refresh_token — ensure offline_access scope is granted and reconnect with prompt=consent"
    );
  }
  await writeOAuthBundle(bundle);
  accessCache.set(accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function refreshMicrosoftAccessToken(accountId?: string): Promise<OAuthTokenBundle | null> {
  const bundle = await readOAuthBundle("microsoft", accountId);
  if (!bundle?.refreshToken) return null;

  if (microsoftOAuthClientConfig()) {
    try {
      const body = new URLSearchParams({
        refresh_token: bundle.refreshToken,
        grant_type: "refresh_token",
        scope: bundle.scopes.join(" "),
      });
      const tok = await postToken(body);
      if (tok.access_token) {
        bundle.accessToken = tok.access_token;
        bundle.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000;
        if (tok.refresh_token) bundle.refreshToken = tok.refresh_token;
        if (tok.scope) {
          bundle.scopes = mergeMicrosoftGrantedScopes(bundle.scopes, tok.scope.split(" ").filter(Boolean));
        }
        bundle.updatedAt = Date.now();
        await writeOAuthBundle(bundle);
        accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
        return bundle;
      }
    } catch {
      /* try hosted broker */
    }
  }

  const hosted = await refreshOAuthViaVireonHostedBroker("microsoft", bundle.refreshToken);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) {
    bundle.scopes = mergeMicrosoftGrantedScopes(bundle.scopes, hosted.scopes);
  }
  bundle.updatedAt = Date.now();
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function getMicrosoftAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("microsoft", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("microsoft");
    bundle = accounts[0] ?? null;
  }
  if (!bundle) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshMicrosoftAccessToken(bundle.accountId);
  return refreshed?.accessToken ?? null;
}

export async function revokeMicrosoftAccount(accountId: string): Promise<void> {
  accessCache.delete(accountId);
  await deleteOAuthBundle("microsoft", accountId);
}

export async function listMicrosoftOAuthAccounts(): Promise<
  Array<{ accountId: string; email?: string; scopes: string[]; expiresAt: number }>
> {
  const accounts = await listOAuthAccounts("microsoft");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
  }));
}
