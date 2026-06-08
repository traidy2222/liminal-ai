/**
 * Hosted Xero OAuth for CLI, desktop sidecar, and TUI — opens vireondynamics.com/connect/xero.
 */
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { openExternalUrl } from "./open_external_url.js";
import {
  applyHostedOAuthHandoff,
  buildHostedIntegrationConnectUrl,
  type HostedOAuthHandoffPayload,
} from "./hosted_oauth_connect.js";
import { defaultVireonSiteOrigin } from "./vireon_account.js";
import type { OAuthTokenBundle } from "./oauth_store.js";
import type { XeroMode } from "./xero_oauth_scopes.js";

const HANDOFF_SUFFIX = "/api/integrations/oauth/handoff";
const FLOW_TIMEOUT_MS = 10 * 60_000;

export type XeroConnectResult = {
  email?: string;
  accountId: string;
  tenantName?: string;
};

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

export interface RunXeroHostedConnectOptions {
  siteOrigin?: string;
  mode?: XeroMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted Xero OAuth; resolves when tokens are POSTed back. */
export function runXeroHostedConnectFlow(
  options: RunXeroHostedConnectOptions = {}
): Promise<XeroConnectResult> {
  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const origin = (options.siteOrigin?.trim() || defaultVireonSiteOrigin()).replace(/\/$/, "");
  const mode = options.mode ?? "read_write";
  const log = options.onStatus ?? ((m: string) => console.log(m));

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const siteOriginHeader = origin;

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": siteOriginHeader,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (url.pathname !== HANDOFF_SUFFIX || req.method !== "POST") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        const body = (await readJsonBody(req)) as HostedOAuthHandoffPayload & {
          bundle?: HostedOAuthHandoffPayload["bundle"];
        };
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

        const bundle: OAuthTokenBundle = await applyHostedOAuthHandoff({
          provider: "xero",
          state,
          bundle: {
            provider: "xero",
            accountId: b.accountId,
            email: b.email,
            accessToken: b.accessToken,
            refreshToken: b.refreshToken,
            expiresAt: b.expiresAt,
            scopes: b.scopes ?? [],
            metadata: b.metadata,
          },
        });

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": siteOriginHeader,
        });
        res.end(JSON.stringify({ ok: true }));

        clearTimeout(timer);
        server.close();
        const meta = bundle.metadata as { tenantName?: string } | undefined;
        resolve({
          email: bundle.email,
          accountId: bundle.accountId,
          tenantName: meta?.tenantName,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": siteOriginHeader,
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
      const redirectUri = `http://127.0.0.1:${addr.port}${HANDOFF_SUFFIX}`;
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
        provider: "xero",
        harnessRedirectUri: redirectUri,
        harnessState: state,
        siteOrigin: origin,
        mode,
      });

      log(`Opening Xero sign-in — complete in your browser (timeout ${Math.round(timeoutMs / 60000)}m)`);
      log(connectUrl);

      if (options.openBrowser !== false) {
        openExternalUrl(connectUrl);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Xero sign-in. Try again."));
    }, timeoutMs);

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
