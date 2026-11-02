/**
 * Refresh hosted-integration OAuth tokens via vireondynamics.com when client secrets are not on the harness.
 */

const DEFAULT_REFRESH_URL = "https://www.vireondynamics.com/api/integrations/oauth/refresh";

const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export type HostedOAuthRefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
};

function hostedOAuthRefreshUrl(): string {
  return (
    process.env.AGENT_HOSTED_OAUTH_REFRESH_URL?.trim() ||
    process.env.LIMINAL_HOSTED_OAUTH_REFRESH_URL?.trim() ||
    DEFAULT_REFRESH_URL
  );
}

export function expiresAtFromOAuthExpiresIn(expiresIn?: number): number {
  return expiresIn != null ? Date.now() + expiresIn * 1000 - 60_000 : Date.now() + FAR_FUTURE_MS;
}

/**
 * Exchange refresh_token through Vireon hosted broker (client secrets on Vercel).
 * The provider refresh token authenticates this exchange for CE and paid users.
 * An optional, expired Liminal license must not block an existing provider grant.
 */
export async function refreshOAuthViaVireonHostedBroker(
  provider: string,
  refreshToken: string
): Promise<HostedOAuthRefreshResult | null> {
  const rt = refreshToken.trim();
  if (!rt) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const res = await fetch(hostedOAuthRefreshUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({ provider, refresh_token: rt }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      scopes?: string[];
    };
    if (!res.ok || !json.access_token) {
      return null;
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token?.trim() || rt,
      expiresAt: json.expires_at ?? Date.now() + 3600_000,
      scopes: json.scopes,
    };
  } catch {
    return null;
  }
}
