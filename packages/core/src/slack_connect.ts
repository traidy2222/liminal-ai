/**
 * Slack OAuth — direct loopback when SLACK_OAUTH_CLIENT_* in .env, else Vireon hosted handoff.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import { openExternalUrl } from "./open_external_url.js";
import {
  buildSlackAuthUrl,
  exchangeSlackCode,
  slackOAuthClientConfig,
  syncSlackBundleScopes,
} from "./slack_oauth_broker.js";
import {
  SLACK_DEFAULT_MODE,
  scopesForSlackMode,
  slackHostedConnectExtra,
  type SlackMode,
} from "./slack_oauth_scopes.js";

const FLOW_TIMEOUT_MS = 10 * 60_000;

/** Default CLI loopback port — add http://127.0.0.1:38476/oauth/slack/callback to Slack app redirects. */
export const SLACK_OAUTH_LOOPBACK_PORT_DEFAULT = 38476;

export function resolveSlackOAuthLoopbackPort(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < 65536) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.SLACK_OAUTH_LOOPBACK_PORT?.trim());
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) return Math.floor(fromEnv);
  return SLACK_OAUTH_LOOPBACK_PORT_DEFAULT;
}

export type SlackConnectResult = {
  accountId: string;
  email?: string;
  teamName?: string;
  scopes: string[];
};

export interface RunSlackHostedConnectOptions {
  siteOrigin?: string;
  mode?: SlackMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
  /** Force hosted Vireon flow even when SLACK_OAUTH_CLIENT_* is set. */
  forceHosted?: boolean;
}

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

/** Direct Slack OAuth with user_scope on loopback (bypasses Vireon). */
export function runSlackDirectConnectFlow(
  options: RunSlackHostedConnectOptions = {}
): Promise<SlackConnectResult> {
  const cfg = slackOAuthClientConfig();
  if (!cfg) {
    return Promise.reject(
      new Error(
        "Slack direct OAuth not configured. Add SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET to .env " +
          "(see docs/guides/slack.md), or use hosted connect via Vireon."
      )
    );
  }

  const mode = options.mode ?? SLACK_DEFAULT_MODE;
  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const log = options.onStatus ?? ((m: string) => console.log(m));
  const userScopes = scopesForSlackMode(mode);

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/oauth/slack/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid OAuth state</h1>");
        reject(new Error("Slack OAuth state mismatch"));
        server.close();
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Slack OAuth error</h1><p>${err}</p>`);
        reject(new Error(`Slack OAuth error: ${err}`));
        server.close();
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Missing code</h1>");
        reject(new Error("Slack OAuth callback missing code"));
        server.close();
        return;
      }

      const port = (server.address() as { port: number })?.port;
      const redirectUri = `http://127.0.0.1:${port}/oauth/slack/callback`;

      try {
        const bundle = await exchangeSlackCode({ code, redirectUri, mode });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h1>Slack connected</h1><p>${bundle.metadata?.teamName ?? bundle.accountId} — ${bundle.scopes.length} scopes. Close this tab.</p></body></html>`
        );
        resolve({
          accountId: bundle.accountId,
          teamName: typeof bundle.metadata?.teamName === "string" ? bundle.metadata.teamName : undefined,
          scopes: bundle.scopes,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>Token exchange failed</h1><p>${msg}</p>`);
        reject(e instanceof Error ? e : new Error(msg));
      } finally {
        server.close();
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Slack sign-in. Try again."));
    }, timeoutMs);

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    server.listen(resolveSlackOAuthLoopbackPort(), "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        clearTimeout(timer);
        reject(new Error("Could not bind loopback port"));
        return;
      }
      const redirectUri = `http://127.0.0.1:${addr.port}/oauth/slack/callback`;
      if (!isAllowedRedirectUri(redirectUri)) {
        clearTimeout(timer);
        reject(new Error("Invalid redirect URI"));
        return;
      }
      const authUrl = buildSlackAuthUrl({ redirectUri, userScopes, state });
      log(`Opening Slack sign-in (direct OAuth, ${userScopes.length} user scopes)`);
      log(authUrl);
      if (options.openBrowser !== false) openExternalUrl(authUrl);
    });
  });
}

/** Prefer direct OAuth when client credentials exist; else Vireon hosted handoff. */
export function runSlackHostedConnectFlow(
  options: RunSlackHostedConnectOptions = {}
): Promise<SlackConnectResult> {
  const mode = options.mode ?? SLACK_DEFAULT_MODE;
  const log = options.onStatus ?? ((m: string) => console.log(m));

  if (slackOAuthClientConfig() && !options.forceHosted) {
    return runSlackDirectConnectFlow(options);
  }

  return runHostedIntegrationConnectFlow({
    provider: "slack",
    siteOrigin: options.siteOrigin,
    mode,
    extra: slackHostedConnectExtra(mode),
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  })
    .then(async (r) => {
      let scopes = r.scopes ?? [];
      try {
        scopes = await syncSlackBundleScopes(r.accountId);
      } catch {
        log("Warning: could not verify Slack token scopes after connect — tools may still fail with missing_scope");
      }
      return {
        accountId: r.accountId,
        email: r.email,
        teamName: (r.metadata as { teamName?: string } | undefined)?.teamName,
        scopes,
      };
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (slackOAuthClientConfig()) {
        log("Hosted Slack connect failed — retrying direct OAuth with SLACK_OAUTH_CLIENT_ID from .env");
        return runSlackDirectConnectFlow(options);
      }
      throw new Error(
        `${msg}\n\nHosted Slack OAuth may not be forwarding user_scope to Slack. ` +
          `Add SLACK_OAUTH_CLIENT_ID + SLACK_OAUTH_CLIENT_SECRET to .env for direct connect, ` +
          `or fix Vireon /connect/slack to pass user_scope= to slack.com/oauth/v2/authorize.`
      );
    });
}
