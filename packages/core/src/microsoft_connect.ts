/**
 * Browser-based Microsoft Entra OAuth for local harness (web / CLI / desktop).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  microsoftOAuthClientConfig,
} from "./microsoft_oauth_broker.js";
import {
  MICROSOFT_OAUTH_SCOPES_FULL,
  scopesForMicrosoftServices,
  resolveMicrosoftServices,
} from "./microsoft_connector_catalog.js";
import type { OAuthTokenBundle } from "./oauth_store.js";
import { openExternalUrl } from "./open_external_url.js";

const FLOW_TIMEOUT_MS = 5 * 60_000;

export const MICROSOFT_OAUTH_LOOPBACK_PORT_DEFAULT = 38476;

/** Loopback hostname for Microsoft redirect URIs (Azure often requires localhost, not 127.0.0.1). */
export function microsoftOAuthLoopbackHost(): string {
  return (
    process.env.MICROSOFT_OAUTH_LOOPBACK_HOST?.trim() ||
    process.env.OAUTH_LOOPBACK_HOST?.trim() ||
    "localhost"
  );
}

export function microsoftOAuthCallbackUri(port: number): string {
  return `http://${microsoftOAuthLoopbackHost()}:${port}/oauth/microsoft/callback`;
}

export function resolveMicrosoftOAuthLoopbackPort(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < 65536) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.MICROSOFT_OAUTH_LOOPBACK_PORT?.trim());
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) return Math.floor(fromEnv);
  return MICROSOFT_OAUTH_LOOPBACK_PORT_DEFAULT;
}

export type MicrosoftConnectResult = {
  accountId: string;
  email?: string;
  scopes: string[];
};

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

export interface RunMicrosoftConnectFlowOptions {
  redirectUri?: string;
  port?: number;
  scopes?: string[];
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runMicrosoftConnectFlow(
  options: RunMicrosoftConnectFlowOptions = {}
): Promise<MicrosoftConnectResult> {
  if (!microsoftOAuthClientConfig()) {
    return Promise.reject(
      new Error(
        "Microsoft 365 OAuth is not configured. Add MICROSOFT_OAUTH_CLIENT_ID (and optional secret) to .env " +
          "(see docs/guides/microsoft-365.md). Register redirect URI http://localhost:<port>/oauth/microsoft/callback " +
          "in Azure Portal → App registrations."
      )
    );
  }

  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const log = options.onStatus ?? ((m: string) => console.log(m));

  let scopes = options.scopes;
  if (!scopes?.length) {
    const presets = resolveMicrosoftServices(options.services);
    scopes =
      presets.length > 0
        ? scopesForMicrosoftServices(presets, options.mode ?? "read_write")
        : MICROSOFT_OAUTH_SCOPES_FULL;
  }

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      const pathname = url.pathname;

      if (req.method === "GET" && pathname !== "/oauth/microsoft/callback" && pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid state</h1>");
        reject(new Error("OAuth state mismatch"));
        server.close();
        return;
      }

      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Microsoft OAuth error</h1><p>${err}</p>`);
        reject(new Error(`Microsoft OAuth error: ${err}`));
        server.close();
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Missing code</h1>");
        reject(new Error("Missing authorization code"));
        server.close();
        return;
      }

      const port = (server.address() as { port: number })?.port;
      const redirectUri =
        options.redirectUri?.trim() || microsoftOAuthCallbackUri(port);

      try {
        const bundle: OAuthTokenBundle = await exchangeMicrosoftCode({
          code,
          redirectUri,
          scopes,
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h1>Microsoft 365 connected</h1><p>Signed in as ${bundle.email ?? bundle.accountId}. You can close this tab.</p></body></html>`
        );
        resolve({
          accountId: bundle.accountId,
          email: bundle.email,
          scopes: bundle.scopes,
        });
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>Token exchange failed</h1><p>${e instanceof Error ? e.message : String(e)}</p>`);
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        server.close();
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Microsoft OAuth timed out after 5 minutes — try connecting again"));
    }, timeoutMs);

    const listenPort = options.redirectUri?.trim()
      ? 0
      : resolveMicrosoftOAuthLoopbackPort(options.port);

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    server.listen(listenPort, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        clearTimeout(timer);
        reject(new Error("Failed to bind loopback server"));
        return;
      }
      const redirectUri =
        options.redirectUri?.trim() || microsoftOAuthCallbackUri(addr.port);
      if (!isAllowedRedirectUri(redirectUri)) {
        clearTimeout(timer);
        server.close();
        reject(new Error(`redirect URI must be loopback http: ${redirectUri}`));
        return;
      }
      let authUrl: string;
      try {
        authUrl = buildMicrosoftAuthUrl({ redirectUri, scopes: scopes!, state });
      } catch (e) {
        clearTimeout(timer);
        server.close();
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      log(
        `Opening Microsoft sign-in…\n` +
          `Waiting for callback at:\n  ${redirectUri}\n` +
          `(Add that URI under Azure Portal → App registration → Authentication → Redirect URIs.)\n` +
          `Complete consent in the browser. Leave this terminal open until you see "Microsoft 365 connected".\n` +
          `If the browser does not open, paste this URL:\n${authUrl}`
      );
      if (options.openBrowser !== false) openExternalUrl(authUrl);
    });

    server.on("close", () => clearTimeout(timer));
  });
}

export function buildMicrosoftAuthUrlForWeb(opts: {
  redirectUri: string;
  state: string;
  services?: string[];
  mode?: "read_write" | "read_only";
}): string {
  const presets = resolveMicrosoftServices(opts.services);
  const scopes =
    presets.length > 0
      ? scopesForMicrosoftServices(presets, opts.mode ?? "read_write")
      : MICROSOFT_OAUTH_SCOPES_FULL;
  return buildMicrosoftAuthUrl({
    redirectUri: opts.redirectUri,
    scopes,
    state: opts.state,
  });
}
