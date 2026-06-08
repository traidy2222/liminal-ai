/**
 * Slack user OAuth tokens (hosted handoff → ~/.liminal/oauth/slack/).
 */
import {
  type OAuthTokenBundle,
  readOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";

const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const accessCache = new Map<string, { token: string; expiresAt: number }>();

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

  const expiresAt = bundle.expiresAt > Date.now() ? bundle.expiresAt : Date.now() + FAR_FUTURE_MS;
  accessCache.set(bundle.accountId, { token: bundle.accessToken, expiresAt });
  return bundle.accessToken;
}

export async function revokeSlackAccount(accountId: string): Promise<void> {
  const bundle = await readOAuthBundle("slack", accountId);
  accessCache.delete(accountId);
  if (bundle?.accessToken) {
    try {
      await fetch("https://slack.com/api/auth.revoke", {
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
