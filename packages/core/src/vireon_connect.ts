/**
 * Browser-based Vireon sign-in for local harness (TUI / CLI / web).
 * Opens www/connect/harness; user signs in; site POSTs license to loopback.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { applyVireonLicenseToken, defaultVireonSiteOrigin } from "./vireon_account.js";
import { ensureEnterpriseEditionInstalled, tierRequiresEnterprisePackage } from "./enterprise_install.js";
import { openExternalUrl } from "./open_external_url.js";

const CONNECT_PATH = "/connect/harness";
const CALLBACK_PATH = "/callback";
const FLOW_TIMEOUT_MS = 5 * 60_000;

export type VireonConnectResult = {
  email: string;
  tier: string;
  entitlements: string[];
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

function siteOrigin(override?: string): string {
  return (override?.trim() || defaultVireonSiteOrigin()).replace(/\/$/, "");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

export interface RunVireonConnectOptions {
  siteOrigin?: string;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Run the loopback connect flow. Resolves when the browser POSTs a license token.
 */
export function runVireonConnectFlow(
  options: RunVireonConnectOptions = {}
): Promise<VireonConnectResult> {
  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const origin = siteOrigin(options.siteOrigin);
  const log = options.onStatus ?? ((m: string) => console.log(m));

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (url.pathname !== CALLBACK_PATH || req.method !== "POST") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        const body = (await readJsonBody(req)) as {
          token?: string;
          state?: string;
          email?: string;
          licenseSub?: string;
        };
        if (body.state !== state) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid state" }));
          return;
        }
        const token = body.token?.trim();
        const email = body.email?.trim() || "vireon@user";
        if (!token) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing token" }));
          return;
        }

        const resolved = await applyVireonLicenseToken(token, {
          email,
          source: "browser",
          licenseSub: body.licenseSub,
        });

        if (tierRequiresEnterprisePackage(resolved.tier)) {
          try {
            await ensureEnterpriseEditionInstalled({ token, force: false });
          } catch {
            /* login still succeeds; harness will retry install on wire */
          }
        }

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        });
        res.end(JSON.stringify({ ok: true }));

        clearTimeout(timer);
        server.close();
        resolve({
          email,
          tier: resolved.tier,
          entitlements: [...resolved.entitlements],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
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
      const redirectUri = `http://127.0.0.1:${addr.port}${CALLBACK_PATH}`;
      if (!isAllowedRedirectUri(redirectUri)) {
        reject(new Error("Invalid redirect URI"));
        return;
      }
      const connectUrl = new URL(CONNECT_PATH, `${origin}/`);
      connectUrl.searchParams.set("redirect_uri", redirectUri);
      connectUrl.searchParams.set("state", state);

      log(`Waiting for sign-in — complete in your browser (timeout ${Math.round(timeoutMs / 60000)}m)`);
      log(connectUrl.toString());

      if (options.openBrowser !== false) {
        openExternalUrl(connectUrl.toString());
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Vireon sign-in. Try again."));
    }, timeoutMs);

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
