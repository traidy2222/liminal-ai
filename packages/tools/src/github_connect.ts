/**
 * Curated GitHub MCP — hosted OAuth or legacy PAT via env.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getGithubAccessToken,
  listGithubOAuthAccounts,
  revokeGithubAccount,
  type GithubMode,
} from "@liminal/core";
import {
  deleteConnection,
  githubOAuthAuthScheme,
  listConnectionsByParent,
  readConnection,
  type AuthScheme,
} from "./api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "./mcp_attach.js";

export const GITHUB_PARENT_PROVIDER = "github";
export const GITHUB_MCP_CONNECTION_NAME = "github";

const DEFAULT_GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export function githubMcpEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GITHUB_MCP") !== "0";
}

export function githubTokenEnvVar(): string {
  return effectiveHarnessEnvRaw("GITHUB_TOKEN_ENV")?.trim() || "GITHUB_TOKEN";
}

export function githubMcpUrl(readOnly = false): string {
  let url = effectiveHarnessEnvRaw("GITHUB_MCP_URL")?.trim() || DEFAULT_GITHUB_MCP_URL;
  if (!url.endsWith("/")) url += "/";
  if (readOnly && !url.includes("/readonly")) {
    url = `${url}readonly`;
  }
  return url;
}

export function githubTokenPresent(): boolean {
  const v = process.env[githubTokenEnvVar()]?.trim();
  return !!v;
}

export async function githubAuthAvailable(): Promise<boolean> {
  if (githubTokenPresent()) return true;
  const accounts = await listGithubOAuthAccounts();
  return accounts.length > 0;
}

/** Default: attach on boot when OAuth or GITHUB_TOKEN is available (opt out with AGENT_GITHUB_CONNECT_ON_BOOT=0). */
export function githubConnectOnBoot(): boolean {
  if (effectiveHarnessEnvRaw("AGENT_GITHUB_CONNECT_ON_BOOT") === "0") return false;
  return true;
}

async function resolveGithubAuth(opts?: {
  readOnly?: boolean;
  accountHint?: string;
}): Promise<{ auth: AuthScheme; accountId?: string; mode: GithubMode } | null> {
  const mode: GithubMode = opts?.readOnly ? "read_only" : "read_write";
  const accounts = await listGithubOAuthAccounts();
  const match = opts?.accountHint
    ? accounts.find((a) => a.accountId === opts.accountHint || a.login === opts.accountHint)
    : accounts[0];
  if (match) {
    return {
      auth: githubOAuthAuthScheme(match.accountId, match.scopes),
      accountId: match.accountId,
      mode,
    };
  }
  const envVar = githubTokenEnvVar();
  if (process.env[envVar]?.trim()) {
    return { auth: { kind: "bearer", envVar }, mode };
  }
  return null;
}

export async function connectGithubMcp(
  registry: ToolRegistry,
  opts?: { readOnly?: boolean; accountHint?: string }
): Promise<{ ok: true; output: string; toolCount: number } | { ok: false; error: string }> {
  if (!githubMcpEnabled()) {
    return { ok: false, error: "GitHub MCP disabled (AGENT_GITHUB_MCP=0)" };
  }
  const resolved = await resolveGithubAuth(opts);
  if (!resolved) {
    return {
      ok: false,
      error:
        "GitHub not connected — open Settings → Integrations → Connect GitHub (hosted sign-in), " +
        "or set GITHUB_TOKEN in .env for legacy PAT auth.",
    };
  }
  const token = resolved.auth.kind === "oauth2" ? await getGithubAccessToken(resolved.accountId) : null;
  if (resolved.auth.kind === "oauth2" && !token) {
    return {
      ok: false,
      error: "GitHub OAuth token missing or unreadable — reconnect via Settings → Integrations.",
    };
  }
  const url = githubMcpUrl(opts?.readOnly === true);
  try {
    const { record, registered } = await attachMcpConnection(registry, {
      name: GITHUB_MCP_CONNECTION_NAME,
      url,
      auth: resolved.auth,
      readOnly: opts?.readOnly === true,
      parentProvider: GITHUB_PARENT_PROVIDER,
      providerId: "github",
      oauthAccountId: resolved.accountId,
      services: [resolved.mode],
    });
    return {
      ok: true,
      output: `Connected GitHub MCP at ${url}\nRegistered ${registered.length} tools as mcp_${record.name}_*`,
      toolCount: registered.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectGithubMcp(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth = false
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const registries = Array.isArray(registry) ? registry : [registry];
  const conns = await listConnectionsByParent(GITHUB_PARENT_PROVIDER);
  const legacy = await readConnection(GITHUB_MCP_CONNECTION_NAME);
  const toRemove =
    conns.length > 0
      ? conns
      : legacy?.kind === "mcp"
        ? [legacy]
        : [];
  if (toRemove.length === 0 && !revokeOAuth) {
    return { ok: false, error: "no GitHub MCP connection attached" };
  }
  let removed = 0;
  for (const c of toRemove) {
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }
  if (revokeOAuth) {
    const accounts = await listGithubOAuthAccounts();
    for (const a of accounts) {
      await revokeGithubAccount(a.accountId);
    }
  }
  return {
    ok: true,
    output:
      `Disconnected GitHub MCP. Removed ${removed} tools from ${toRemove.length} connection(s)` +
      `${revokeOAuth ? " (OAuth tokens revoked)" : ""}.`,
  };
}
