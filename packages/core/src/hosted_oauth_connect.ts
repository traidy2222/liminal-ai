/**
 * Hosted OAuth connect — Vireon site completes provider consent, POSTs tokens to local harness.
 */
import { defaultVireonSiteOrigin } from "./vireon_account.js";
import { type OAuthTokenBundle, writeOAuthBundle } from "./oauth_store.js";

export type HostedOAuthHandoffPayload = {
  provider: string;
  state: string;
  bundle: Omit<OAuthTokenBundle, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  };
};

const DEFAULT_HANDOFF_PATH = "/api/integrations/oauth/handoff";

/** Loopback URIs the hosted site may POST OAuth bundles to. */
export function isHostedOAuthHandoffUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return false;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return (
      path === "/callback" ||
      path.endsWith("/api/vireon/auth/callback") ||
      path.endsWith(DEFAULT_HANDOFF_PATH)
    );
  } catch {
    return false;
  }
}

export function hostedOAuthHandoffPath(port: number): string {
  return `http://127.0.0.1:${port}${DEFAULT_HANDOFF_PATH}`;
}

export function buildHostedIntegrationConnectUrl(opts: {
  provider: string;
  harnessRedirectUri: string;
  harnessState: string;
  siteOrigin?: string;
  mode?: string;
  extra?: Record<string, string>;
}): string {
  const origin = (opts.siteOrigin?.trim() || defaultVireonSiteOrigin()).replace(/\/$/, "");
  const url = new URL(`/connect/${encodeURIComponent(opts.provider)}`, `${origin}/`);
  url.searchParams.set("redirect_uri", opts.harnessRedirectUri);
  url.searchParams.set("state", opts.harnessState);
  if (opts.mode?.trim()) url.searchParams.set("mode", opts.mode.trim());
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v.trim()) url.searchParams.set(k, v.trim());
  }
  return url.toString();
}

export type ParsedHostedOAuthHandoffBody = {
  state?: string;
  provider?: string;
  bundle?: HostedOAuthHandoffPayload["bundle"];
};

/** True when the hosted site used an HTML form POST (not JSON fetch). */
export function isHostedOAuthFormHandoffContent(contentType: string, rawBody: string): boolean {
  const ct = contentType.toLowerCase();
  const trimmed = rawBody.trimStart();
  return (
    trimmed.startsWith("payload=") ||
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  );
}

/** Parse JSON or form-encoded handoff POST from vireondynamics.com → loopback harness. */
export function parseHostedOAuthHandoffHttpBody(
  rawBody: string,
  contentType = ""
): ParsedHostedOAuthHandoffBody {
  const trimmed = rawBody.trim();
  if (!trimmed) return {};

  if (isHostedOAuthFormHandoffContent(contentType, trimmed)) {
    const params = new URLSearchParams(trimmed);
    const payload = params.get("payload")?.trim();
    if (payload) {
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ParsedHostedOAuthHandoffBody;
    }
    return Object.fromEntries(params.entries()) as ParsedHostedOAuthHandoffBody;
  }

  return JSON.parse(trimmed) as ParsedHostedOAuthHandoffBody;
}

export async function applyHostedOAuthHandoff(
  payload: HostedOAuthHandoffPayload
): Promise<OAuthTokenBundle> {
  const now = Date.now();
  const bundle: OAuthTokenBundle = {
    provider: payload.bundle.provider,
    accountId: payload.bundle.accountId,
    email: payload.bundle.email,
    accessToken: payload.bundle.accessToken,
    refreshToken: payload.bundle.refreshToken,
    expiresAt: payload.bundle.expiresAt,
    scopes: payload.bundle.scopes,
    metadata: payload.bundle.metadata,
    createdAt: payload.bundle.createdAt ?? now,
    updatedAt: now,
  };
  if (!bundle.refreshToken?.trim()) {
    throw new Error("missing refresh_token in hosted OAuth handoff");
  }
  await writeOAuthBundle(bundle);
  return bundle;
}
