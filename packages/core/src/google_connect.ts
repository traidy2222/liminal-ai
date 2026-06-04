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

const FLOW_TIMEOUT_MS = 5 * 60_000;

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

function openBrowser(url: string): void {
  const start =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  import("node:child_process").then(({ spawn }) => {
    const child = spawn(start[0]!, start.slice(1), { detached: true, stdio: "ignore" });
    child.unref();
  }).catch(() => {
    console.log(`Open this URL in your browser:\n${url}`);
  });
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
        "Google Workspace OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to " +
          "dreamthedream/.env (see docs/guides/google-workspace.md). " +
          "Note: Google sign-in on vireondynamics.com is Supabase login-only — it does not provide Drive/Gmail API credentials; " +
          "use a Google Cloud OAuth client with Workspace scopes and redirect http://127.0.0.1:<port>/oauth/google/callback."
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
      reject(new Error("Google OAuth timed out"));
    }, timeoutMs);

    server.listen(options.port ?? 0, "127.0.0.1", () => {
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
      log(`Opening Google sign-in…\nIf the browser does not open:\n${authUrl}`);
      if (options.openBrowser !== false) openBrowser(authUrl);
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
