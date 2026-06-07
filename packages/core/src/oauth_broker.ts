/**
 * Google OAuth 2.0 — authorization URL, code exchange, refresh, access token resolution.
 */
import { normalizeGoogleScopes } from "./google_oauth_scopes.js";
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

function mergeGoogleGrantedScopes(existing: string[], incoming: string[]): string[] {
  return normalizeGoogleScopes([...existing, ...incoming]);
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** In-process access token cache (accountId → { token, expiresAt }). */
const accessCache = new Map<string, { token: string; expiresAt: number }>();

export function googleOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(opts: {
  redirectUri: string;
  scopes: string[];
  state: string;
  accessType?: "offline" | "online";
}): string {
  const cfg = googleOAuthClientConfig();
  if (!cfg) throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    access_type: opts.accessType ?? "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
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
    const desc = json.error_description ?? json.error ?? `token HTTP ${res.status}`;
    if (json.error === "invalid_client" || /client secret is invalid/i.test(desc)) {
      throw new Error(
        `${desc} — check GOOGLE_OAUTH_CLIENT_SECRET in dreamthedream/.env matches Google Cloud → Credentials → your OAuth client (reset secret there if unsure).`
      );
    }
    throw new Error(desc);
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

export async function exchangeGoogleCode(opts: {
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
  const email = await fetchGoogleEmail(tok.access_token);
  const accountId = sanitizeOAuthAccountId(email ?? "default");
  const expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000;
  const grantedScopes = mergeGoogleGrantedScopes(
    [],
    tok.scope?.split(" ").filter(Boolean) ?? opts.scopes
  );
  const existing = await readOAuthBundle("google", accountId);
  const bundle: OAuthTokenBundle = {
    provider: "google",
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
    throw new Error("no refresh_token — revoke app access in Google Account and reconnect with prompt=consent");
  }
  await writeOAuthBundle(bundle);
  accessCache.set(accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

export async function refreshGoogleAccessToken(accountId?: string): Promise<OAuthTokenBundle | null> {
  const bundle = await readOAuthBundle("google", accountId);
  if (!bundle?.refreshToken) return null;
  const body = new URLSearchParams({
    refresh_token: bundle.refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const tok = await postToken(body);
    if (!tok.access_token) return null;
    bundle.accessToken = tok.access_token;
    bundle.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000;
    if (tok.scope) {
      bundle.scopes = mergeGoogleGrantedScopes(bundle.scopes, tok.scope.split(" ").filter(Boolean));
    }
    bundle.updatedAt = Date.now();
    await writeOAuthBundle(bundle);
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle;
  } catch {
    return null;
  }
}

export async function getGoogleAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("google", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("google");
    bundle = accounts[0] ?? null;
  }
  if (!bundle) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(bundle.accountId);
  return refreshed?.accessToken ?? null;
}

export async function revokeGoogleAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("google", accountId);
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
  await deleteOAuthBundle("google", accountId);
}

export async function listGoogleOAuthAccounts(): Promise<
  Array<{ accountId: string; email?: string; scopes: string[]; expiresAt: number }>
> {
  const accounts = await listOAuthAccounts("google");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
  }));
}
