/**
 * Browser-based Vireon sign-in for local harness (TUI / CLI / web / desktop).
 * Opens www/connect/harness; user signs in; site redirects license to loopback GET.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { applyVireonLicenseToken, defaultVireonSiteOrigin } from "./vireon_account.js";
import { ensureEnterpriseEditionInstalled, tierRequiresEnterprisePackage } from "./enterprise_install.js";
import { openExternalUrl } from "./open_external_url.js";

const CONNECT_PATH = "/connect/harness";
/** Matches web harness + HarnessConnectClient GET redirect handoff. */
const CALLBACK_PATH = "/api/vireon/auth/callback";
const LEGACY_CALLBACK_PATH = "/callback";
const FLOW_TIMEOUT_MS = 5 * 60_000;

export type VireonConnectResult = {
  email: string;
  tier: string;
  entitlements: string[];
};

type CallbackParams = {
  token: string;
  state: string;
  email?: string;
  licenseSub?: string;
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

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Private-Network": "true",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function callbackHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #e8e8e8; background: #0a0a0a; }
    h1 { font-size: 1.25rem; margin-bottom: 0.75rem; }
    p { color: #aaa; line-height: 1.5; margin: 0 0 0.75rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${bodyHtml}</p>
</body>
</html>`;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function readCallbackParams(req: IncomingMessage, url: URL): CallbackParams | null {
  if (req.method === "GET") {
    return {
      token: url.searchParams.get("token")?.trim() ?? "",
      state: url.searchParams.get("state")?.trim() ?? "",
      email: url.searchParams.get("email")?.trim() || undefined,
      licenseSub: url.searchParams.get("licenseSub")?.trim() || undefined,
    };
  }
  return null;
}

async function readPostCallbackParams(req: IncomingMessage): Promise<CallbackParams> {
  const body = (await readJsonBody(req)) as {
    token?: string;
    state?: string;
    email?: string;
    licenseSub?: string;
  };
  return {
    token: body.token?.trim() ?? "",
    state: body.state?.trim() ?? "",
    email: body.email?.trim() || undefined,
    licenseSub: body.licenseSub?.trim() || undefined,
  };
}

function isCallbackPath(pathname: string): boolean {
  return pathname === CALLBACK_PATH || pathname === LEGACY_CALLBACK_PATH;
}

export interface RunVireonConnectOptions {
  siteOrigin?: string;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Run the loopback connect flow. Resolves when the browser hands off a license token.
 */
export function runVireonConnectFlow(
  options: RunVireonConnectOptions = {}
): Promise<VireonConnectResult> {
  const timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  const state = randomBytes(16).toString("hex");
  const origin = siteOrigin(options.siteOrigin);
  const log = options.onStatus ?? ((m: string) => console.log(m));

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result: VireonConnectResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(result);
    };

    const respondJson = (
      res: ServerResponse,
      status: number,
      body: Record<string, unknown>
    ) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        ...corsHeaders(origin),
      });
      res.end(JSON.stringify(body));
    };

    const respondHtml = (res: ServerResponse, status: number, html: string) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...corsHeaders(origin),
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (!isCallbackPath(url.pathname)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const isGet = req.method === "GET";
      const isPost = req.method === "POST";
      if (!isGet && !isPost) {
        res.writeHead(405);
        res.end("Method not allowed");
        return;
      }

      try {
        const params =
          (isGet ? readCallbackParams(req, url) : null) ?? (isPost ? await readPostCallbackParams(req) : null);
        if (!params) {
          respondVireonError(res, isGet, 400, "Invalid request");
          return;
        }

        if (params.state !== state) {
          respondVireonError(res, isGet, 403, "Invalid state");
          return;
        }

        const token = params.token;
        const email = params.email?.trim() || "vireon@user";
        if (!token) {
          respondVireonError(res, isGet, 400, "Missing token");
          return;
        }

        const resolved = await applyVireonLicenseToken(token, {
          email,
          source: "browser",
          licenseSub: params.licenseSub,
        });

        if (tierRequiresEnterprisePackage(resolved.tier)) {
          try {
            await ensureEnterpriseEditionInstalled({ token, force: false });
          } catch {
            /* login still succeeds; harness will retry install on wire */
          }
        }

        if (isGet) {
          respondHtml(
            res,
            200,
            callbackHtml(
              "Connected to Liminal",
              `Signed in as <strong>${escapeHtml(email)}</strong> (${escapeHtml(resolved.tier)}). You can close this tab and return to Liminal.`
            )
          );
        } else {
          respondJson(res, 200, { ok: true });
        }

        finish({
          email,
          tier: resolved.tier,
          entitlements: [...resolved.entitlements],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        respondVireonError(res, isGet, 400, message);
      }
    });

    function respondVireonError(
      res: ServerResponse,
      isGet: boolean,
      status: number,
      message: string
    ) {
      if (isGet) {
        respondHtml(res, status, callbackHtml("Could not connect Liminal", escapeHtml(message)));
        return;
      }
      respondJson(res, status, { error: message });
    }

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
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("Timed out waiting for Vireon sign-in. Try again."));
    }, timeoutMs);

    server.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
