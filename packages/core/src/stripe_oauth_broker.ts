/**
 * Stripe Connect OAuth tokens (hosted handoff → ~/.liminal/oauth/stripe/).
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
import { resolveLicenseTokenForHarness } from "./vireon_account.js";

const STRIPE_CONNECT_TOKEN_URL = "https://connect.stripe.com/oauth/token";
const STRIPE_CONNECT_DEAUTH_URL = "https://connect.stripe.com/oauth/deauthorize";
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const DEFAULT_STRIPE_DEAUTH_URL =
  "https://www.vireondynamics.com/api/integrations/oauth/deauthorize";

const accessCache = new Map<string, { token: string; expiresAt: number }>();

function stripeOAuthClientConfig(): { clientId: string; secretKey: string } | null {
  const clientId =
    process.env.STRIPE_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_STRIPE_OAUTH_CLIENT_ID?.trim();
  const secretKey =
    process.env.STRIPE_OAUTH_SECRET_KEY?.trim() ||
    process.env.STRIPE_SECRET_KEY?.trim() ||
    process.env.AGENT_STRIPE_OAUTH_SECRET_KEY?.trim() ||
    "";
  if (!clientId || !secretKey) return null;
  return { clientId, secretKey };
}

function stripeDeauthUrl(): string {
  return (
    process.env.AGENT_HOSTED_OAUTH_DEAUTH_URL?.trim() ||
    process.env.LIMINAL_HOSTED_OAUTH_DEAUTH_URL?.trim() ||
    DEFAULT_STRIPE_DEAUTH_URL
  );
}

async function persistStripeRefresh(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle> {
  bundle.updatedAt = Date.now();
  await writeOAuthBundle(bundle);
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
  return bundle;
}

async function refreshStripeAccessTokenLocal(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  const cfg = stripeOAuthClientConfig();
  if (!cfg?.secretKey || !bundle.refreshToken?.trim()) return null;
  try {
    const auth = Buffer.from(`${cfg.secretKey}:`).toString("base64");
    const res = await fetch(STRIPE_CONNECT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: bundle.refreshToken,
      }).toString(),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || json.error || !json.access_token) return null;
    bundle.accessToken = json.access_token;
    if (json.refresh_token) bundle.refreshToken = json.refresh_token;
    if (json.scope) bundle.scopes = json.scope.split(/[,\s]+/).filter(Boolean);
    bundle.expiresAt = Date.now() + FAR_FUTURE_MS;
    return persistStripeRefresh(bundle);
  } catch {
    return null;
  }
}

async function refreshStripeAccessToken(bundle: OAuthTokenBundle): Promise<OAuthTokenBundle | null> {
  if (!bundle.refreshToken?.trim()) return null;
  const local = await refreshStripeAccessTokenLocal(bundle);
  if (local) return local;
  const hosted = await refreshOAuthViaVireonHostedBroker("stripe", bundle.refreshToken);
  if (!hosted) return null;
  bundle.accessToken = hosted.accessToken;
  bundle.refreshToken = hosted.refreshToken;
  bundle.expiresAt = hosted.expiresAt;
  if (hosted.scopes?.length) bundle.scopes = hosted.scopes;
  return persistStripeRefresh(bundle);
}

async function deauthorizeStripeRemote(stripeUserId: string): Promise<void> {
  const cfg = stripeOAuthClientConfig();
  if (cfg) {
    try {
      const auth = Buffer.from(`${cfg.secretKey}:`).toString("base64");
      await fetch(STRIPE_CONNECT_DEAUTH_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          stripe_user_id: stripeUserId,
        }).toString(),
      });
    } catch {
      /* local delete still proceeds */
    }
    return;
  }

  const license = await resolveLicenseTokenForHarness();
  if (!license) return;
  try {
    await fetch(stripeDeauthUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${license}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "stripe", stripe_user_id: stripeUserId }),
    });
  } catch {
    /* local delete still proceeds */
    }
}

export function stripeUserIdFromBundle(bundle: OAuthTokenBundle): string | undefined {
  const meta = bundle.metadata?.stripeUserId;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  if (bundle.accountId.startsWith("acct_")) return bundle.accountId;
  return undefined;
}

export async function getStripeAccessToken(accountId?: string): Promise<string | null> {
  const id = accountId ? sanitizeOAuthAccountId(accountId) : undefined;
  const cacheKey = id ?? "default";
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  let bundle = await readOAuthBundle("stripe", id);
  if (!bundle) {
    const accounts = await listOAuthAccounts("stripe");
    bundle = accounts[0] ?? null;
  }
  if (!bundle?.accessToken) return null;

  if (Date.now() < bundle.expiresAt - 30_000) {
    accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle.accessToken;
  }

  const refreshed = await refreshStripeAccessToken(bundle);
  if (refreshed?.accessToken) return refreshed.accessToken;
  if (Date.now() < bundle.expiresAt - 30_000) return bundle.accessToken;
  return null;
}

export async function revokeStripeAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("stripe", accountId);
  accessCache.delete(accountId);
  const stripeUserId = bundle ? stripeUserIdFromBundle(bundle) : undefined;
  if (stripeUserId) {
    await deauthorizeStripeRemote(stripeUserId);
  }
  await deleteOAuthBundle("stripe", accountId);
}

export async function listStripeOAuthAccounts(): Promise<
  Array<{
    accountId: string;
    email?: string;
    scopes: string[];
    expiresAt: number;
    stripeUserId?: string;
    livemode?: boolean;
    businessName?: string;
  }>
> {
  const accounts = await listOAuthAccounts("stripe");
  return accounts.map((a) => ({
    accountId: a.accountId,
    email: a.email,
    scopes: a.scopes,
    expiresAt: a.expiresAt,
    stripeUserId: stripeUserIdFromBundle(a),
    livemode: typeof a.metadata?.livemode === "boolean" ? a.metadata.livemode : undefined,
    businessName:
      typeof a.metadata?.businessName === "string" ? a.metadata.businessName : undefined,
  }));
}
