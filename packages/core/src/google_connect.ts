/**
 * Browser-based Google OAuth for local harness (web / CLI / TUI).
 * Opens Google consent; redirect lands on loopback callback with ?code=&state=
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOAuthClientConfig,
} from "./oauth_broker.js";
import { GOOGLE_OAUTH_SCOPES_FULL, scopesForGoogleServices, resolveGoogleServices } from "./connector_catalog.js";
import type { OAuthTokenBundle } from "./oauth_store.js";
import { openExternalUrl } from "./open_external_url.js";

const FLOW_TIMEOUT_MS = 5 * 60_000;

/** Default CLI loopback port — register this exact redirect URI in Google Cloud (Web client). */
export const GOOGLE_OAUTH_LOOPBACK_PORT_DEFAULT = 38475;

export function resolveGoogleOAuthLoopbackPort(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < 65536) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.GOOGLE_OAUTH_LOOPBACK_PORT?.trim());
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) return Math.floor(fromEnv);
  return GOOGLE_OAUTH_LOOPBACK_PORT_DEFAULT;
}

export type GoogleConnectResult = {
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

export interface RunGoogleConnectFlowOptions {
  redirectUri?: string;
  port?: number;
  scopes?: string[];
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Start loopback server, open Google OAuth, exchange code on callback.
 */
export function runGoogleConnectFlow(
  options: RunGoogleConnectFlowOptions = {}
): Promise<GoogleConnectResult> {
  if (!googleOAuthClientConfig()) {
    return Promise.reject(
      new Error(
        "Google Workspace OAuth is not configured for local loopback. Use hosted connect instead: " +
          "Settings → Integrations → Connect Google, `liminal connect google`, or desktop Integrations. " +
          "Self-hosters: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env " +
          "(see docs/guides/google-workspace.md)."
      )
    );
  }

  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const log = options.onStatus ?? ((m: string) => console.log(m));

  let scopes = options.scopes;
  if (!scopes?.length) {
    const presets = resolveGoogleServices(options.services);
    scopes =
      presets.length > 0
        ? scopesForGoogleServices(presets, options.mode ?? "read_write")
        : GOOGLE_OAUTH_SCOPES_FULL;
  }

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      const pathname = url.pathname;

      if (req.method === "GET" && pathname !== "/oauth/google/callback" && pathname !== "/callback") {
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
        res.end(`<h1>Google OAuth error</h1><p>${err}</p>`);
        reject(new Error(`Google OAuth error: ${err}`));
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
        options.redirectUri?.trim() ||
        `http://127.0.0.1:${port}/oauth/google/callback`;

      try {
        const bundle: OAuthTokenBundle = await exchangeGoogleCode({
          code,
          redirectUri,
          scopes,
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h1>Google connected</h1><p>Signed in as ${bundle.email ?? bundle.accountId}. You can close this tab.</p></body></html>`
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
      reject(new Error("Google OAuth timed out after 5 minutes — run liminal connect google again"));
    }, timeoutMs);

    const listenPort = options.redirectUri?.trim()
      ? 0
      : resolveGoogleOAuthLoopbackPort(options.port);

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
        options.redirectUri?.trim() ||
        `http://127.0.0.1:${addr.port}/oauth/google/callback`;
      if (!isAllowedRedirectUri(redirectUri)) {
        clearTimeout(timer);
        server.close();
        reject(new Error(`redirect URI must be loopback http: ${redirectUri}`));
        return;
      }
      let authUrl: string;
      try {
        authUrl = buildGoogleAuthUrl({ redirectUri, scopes: scopes!, state });
      } catch (e) {
        clearTimeout(timer);
        server.close();
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      log(
        `Opening Google sign-in…\n` +
          `Waiting for callback at:\n  ${redirectUri}\n` +
          `(Add that URI under Google Cloud → Credentials → your OAuth client → Authorized redirect URIs.)\n` +
          `Complete consent in the browser. Leave this terminal open until you see "Google connected".\n` +
          `If the browser does not open, paste this URL:\n${authUrl}`
      );
      if (options.openBrowser !== false) openExternalUrl(authUrl);
    });

    server.on("close", () => clearTimeout(timer));
  });
}

export function buildGoogleAuthUrlForWeb(opts: {
  redirectUri: string;
  state: string;
  services?: string[];
  mode?: "read_write" | "read_only";
}): string {
  const presets = resolveGoogleServices(opts.services);
  const scopes =
    presets.length > 0
      ? scopesForGoogleServices(presets, opts.mode ?? "read_write")
      : GOOGLE_OAUTH_SCOPES_FULL;
  return buildGoogleAuthUrl({
    redirectUri: opts.redirectUri,
    scopes,
    state: opts.state,
  });
}
