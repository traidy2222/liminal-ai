/**
 * Browser-based Azure Resource Manager OAuth (local harness fallback).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import {
  buildAzureAuthUrl,
  exchangeAzureCode,
  azureOAuthConfigured,
} from "./azure_oauth_broker.js";
import {
  scopesForAzureConnect,
  scopesForAzureServices,
  resolveAzureServices,
} from "./azure_connector_catalog.js";
import type { OAuthTokenBundle } from "./oauth_store.js";
import { openExternalUrl } from "./open_external_url.js";

const FLOW_TIMEOUT_MS = 5 * 60_000;
export const AZURE_OAUTH_LOOPBACK_PORT_DEFAULT = 38477;

export function azureOAuthLoopbackHost(): string {
  return (
    process.env.AZURE_OAUTH_LOOPBACK_HOST?.trim() ||
    process.env.OAUTH_LOOPBACK_HOST?.trim() ||
    "localhost"
  );
}

export function azureOAuthCallbackUri(port: number): string {
  return `http://${azureOAuthLoopbackHost()}:${port}/oauth/azure/callback`;
}

export function resolveAzureOAuthLoopbackPort(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < 65536) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.AZURE_OAUTH_LOOPBACK_PORT?.trim());
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) return Math.floor(fromEnv);
  return AZURE_OAUTH_LOOPBACK_PORT_DEFAULT;
}

export type AzureConnectResult = {
  accountId: string;
  email?: string;
  scopes: string[];
};

export interface RunAzureConnectFlowOptions {
  redirectUri?: string;
  port?: number;
  scopes?: string[];
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runAzureConnectFlow(
  options: RunAzureConnectFlowOptions = {}
): Promise<AzureConnectResult> {
  if (!azureOAuthConfigured()) {
    return Promise.reject(
      new Error(
        "Azure OAuth is not configured. Add MICROSOFT_OAUTH_CLIENT_ID (same Entra app as M365) to .env " +
          "(see docs/guides/azure.md). Register redirect URI http://localhost:<port>/oauth/azure/callback " +
          "and add API permission: Azure Service Management → user_impersonation."
      )
    );
  }

  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const log = options.onStatus ?? ((m: string) => console.log(m));

  let scopes = options.scopes;
  if (!scopes?.length) {
    const presets = resolveAzureServices(options.services);
    scopes =
      presets.length > 0
        ? scopesForAzureServices(presets, options.mode ?? "read_write")
        : scopesForAzureConnect(options.mode ?? "read_write");
  }

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      const pathname = url.pathname;

      if (req.method === "GET" && pathname !== "/oauth/azure/callback" && pathname !== "/callback") {
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
        res.end(`<h1>Azure OAuth error</h1><p>${err}</p>`);
        reject(new Error(`Azure OAuth error: ${err}`));
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
      const redirectUri = options.redirectUri?.trim() || azureOAuthCallbackUri(port);

      try {
        const bundle: OAuthTokenBundle = await exchangeAzureCode({
          code,
          redirectUri,
          scopes,
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h1>Azure connected</h1><p>Signed in as ${bundle.email ?? bundle.accountId}. You can close this tab.</p></body></html>`
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

    const port = resolveAzureOAuthLoopbackPort(options.port);
    server.listen(port, "127.0.0.1", () => {
      const redirectUri = options.redirectUri?.trim() || azureOAuthCallbackUri(port);
      const authUrl = buildAzureAuthUrl({ redirectUri, scopes, state });
      log(`Azure sign-in: ${authUrl}`);
      if (options.openBrowser !== false) {
        void openExternalUrl(authUrl);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Azure OAuth timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    server.on("close", () => clearTimeout(timer));
  });
}
