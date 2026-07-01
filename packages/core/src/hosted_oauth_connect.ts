/**
 * Hosted OAuth connect — Vireon site completes provider consent, POSTs tokens to local harness.
 */
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { defaultVireonSiteOrigin } from "./vireon_account.js";
import { openExternalUrl } from "./open_external_url.js";
import { type OAuthTokenBundle, writeOAuthBundle, readOAuthBundle } from "./oauth_store.js";

export type HostedOAuthHandoffPayload = {
  provider: string;
  state: string;
  bundle: Omit<OAuthTokenBundle, "createdAt" | "updatedAt"> & {
    createdAt?: number;
    updatedAt?: number;
  };
};

const DEFAULT_HANDOFF_PATH = "/api/integrations/oauth/handoff";

const VIREON_SITE_ORIGINS = [
  "https://www.vireondynamics.com",
  "https://vireondynamics.com",
] as const;

/** CORS headers for fetch handoff from vireondynamics.com → loopback (Chrome Private Network Access). */
export function hostedOAuthHandoffCorsHeaders(requestOrigin?: string): Record<string, string> {
  const origin = requestOrigin?.trim();
  const allowed = new Set<string>([
    defaultVireonSiteOrigin().replace(/\/$/, ""),
    ...VIREON_SITE_ORIGINS,
  ]);
  const acao = origin && allowed.has(origin) ? origin : defaultVireonSiteOrigin().replace(/\/$/, "");
  return {
    "Access-Control-Allow-Origin": acao,
    "Access-Control-Allow-Private-Network": "true",
  };
}

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
  const provider = payload.bundle.provider;
  const accountId = payload.bundle.accountId;
  const existing = await readOAuthBundle(provider, accountId);
  const incomingScopes = payload.bundle.scopes ?? [];
  const mergedScopes = existing
    ? [...new Set([...existing.scopes, ...incomingScopes])]
    : incomingScopes;
  const incomingMeta = payload.bundle.metadata ?? {};
  const existingMeta = existing?.metadata ?? {};
  const mergedServices = [
    ...new Set([
      ...(Array.isArray(existingMeta.services) ? (existingMeta.services as string[]) : []),
      ...(Array.isArray(incomingMeta.services) ? (incomingMeta.services as string[]) : []),
    ]),
  ];
  const metadata: Record<string, unknown> = {
    ...existingMeta,
    ...incomingMeta,
  };
  if (mergedServices.length > 0) metadata.services = mergedServices;

  const bundle: OAuthTokenBundle = {
    provider,
    accountId,
    email: payload.bundle.email ?? existing?.email,
    accessToken: payload.bundle.accessToken,
    refreshToken: payload.bundle.refreshToken ?? existing?.refreshToken ?? "",
    expiresAt: payload.bundle.expiresAt ?? existing?.expiresAt ?? now + 3600_000,
    scopes: mergedScopes,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    createdAt: existing?.createdAt ?? payload.bundle.createdAt ?? now,
    updatedAt: now,
  };
  if (!bundle.refreshToken?.trim()) {
    throw new Error("missing refresh_token in hosted OAuth handoff");
  }
  await writeOAuthBundle(bundle);
  return bundle;
}

const HOSTED_FLOW_TIMEOUT_MS = 10 * 60_000;

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
}

async function readRawHttpBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export type HostedIntegrationConnectResult = {
  email?: string;
  accountId: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
};

export interface RunHostedIntegrationConnectOptions {
  provider: string;
  siteOrigin?: string;
  mode?: string;
  extra?: Record<string, string>;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted integration OAuth; resolves when tokens are POSTed back. */
export function runHostedIntegrationConnectFlow(
  options: RunHostedIntegrationConnectOptions
): Promise<HostedIntegrationConnectResult> {
  const timeoutMs = options.timeoutMs ?? HOSTED_FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const origin = (options.siteOrigin?.trim() || defaultVireonSiteOrigin()).replace(/\/$/, "");
  const log = options.onStatus ?? ((m: string) => console.log(m));
  const provider = options.provider.trim();

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...hostedOAuthHandoffCorsHeaders(req.headers.origin),
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (url.pathname !== DEFAULT_HANDOFF_PATH || req.method !== "POST") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        const rawBody = await readRawHttpBody(req);
        const contentType = req.headers["content-type"] ?? "";
        const body = parseHostedOAuthHandoffHttpBody(rawBody, contentType) as HostedOAuthHandoffPayload & {
          bundle?: HostedOAuthHandoffPayload["bundle"];
        };
        const htmlHandoff = isHostedOAuthFormHandoffContent(contentType, rawBody);
        if (body.state !== state) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid state" }));
          return;
        }
        const b = body.bundle;
        if (!b?.accessToken || !b.refreshToken || !b.accountId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Incomplete OAuth bundle" }));
          return;
        }

        const bundle = await applyHostedOAuthHandoff({
          provider,
          state,
          bundle: {
            provider: b.provider ?? provider,
            accountId: b.accountId,
            email: b.email,
            accessToken: b.accessToken,
            refreshToken: b.refreshToken,
            expiresAt: b.expiresAt,
            scopes: b.scopes ?? [],
            metadata: b.metadata,
          },
        });

        const cors = hostedOAuthHandoffCorsHeaders(req.headers.origin);
        if (htmlHandoff) {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            ...cors,
          });
          res.end(
            "<!DOCTYPE html><html><body style=\"font-family:system-ui,sans-serif;padding:2rem\"><p><strong>Connected.</strong> Close this tab and return to Liminal.</p></body></html>"
          );
        } else {
          res.writeHead(200, {
            "Content-Type": "application/json",
            ...cors,
          });
          res.end(JSON.stringify({ ok: true }));
        }

        clearTimeout(timer);
        server.close();
        resolve({
          email: bundle.email,
          accountId: bundle.accountId,
          scopes: bundle.scopes,
          metadata: bundle.metadata as Record<string, unknown> | undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, {
          "Content-Type": "application/json",
          ...hostedOAuthHandoffCorsHeaders(req.headers.origin),
        });
        res.end(JSON.stringify({ error: message }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind loopback port"));
        return;
      }
      const redirectUri = hostedOAuthHandoffPath(addr.port);
      try {
        const host = new URL(redirectUri).hostname;
        if (!isLoopbackHost(host)) {
          reject(new Error("Invalid redirect URI"));
          return;
        }
      } catch {
        reject(new Error("Invalid redirect URI"));
        return;
      }

      const connectUrl = buildHostedIntegrationConnectUrl({
        provider,
        harnessRedirectUri: redirectUri,
        harnessState: state,
        siteOrigin: origin,
        mode: options.mode,
        extra: options.extra,
      });

      log(
        `Opening ${provider} sign-in — complete in your browser (timeout ${Math.round(timeoutMs / 60000)}m)`
      );
      log(connectUrl);

      if (options.openBrowser !== false) {
        openExternalUrl(connectUrl);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting for ${provider} sign-in. Try again.`));
    }, timeoutMs);

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
