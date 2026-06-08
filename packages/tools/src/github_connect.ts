/**
 * Curated GitHub MCP — PAT via env, remote Streamable HTTP server.
 */
import type { ToolRegistry } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { deleteConnection, listConnectionsByParent, readConnection } from "./api_connections_store.js";
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

/** Default: attach on boot when GITHUB_TOKEN is set (opt out with AGENT_GITHUB_CONNECT_ON_BOOT=0). */
export function githubConnectOnBoot(): boolean {
  if (effectiveHarnessEnvRaw("AGENT_GITHUB_CONNECT_ON_BOOT") === "0") return false;
  return githubTokenPresent();
}

export async function connectGithubMcp(
  registry: ToolRegistry,
  opts?: { readOnly?: boolean }
): Promise<{ ok: true; output: string; toolCount: number } | { ok: false; error: string }> {
  if (!githubMcpEnabled()) {
    return { ok: false, error: "GitHub MCP disabled (AGENT_GITHUB_MCP=0)" };
  }
  const envVar = githubTokenEnvVar();
  if (!process.env[envVar]?.trim()) {
    return {
      ok: false,
      error: `${envVar} is not set — add a GitHub PAT to .env (classic or fine-grained with repo scope as needed)`,
    };
  }
  const url = githubMcpUrl(opts?.readOnly === true);
  try {
    const { record, registered } = await attachMcpConnection(registry, {
      name: GITHUB_MCP_CONNECTION_NAME,
      url,
      auth: { kind: "bearer", envVar },
      readOnly: opts?.readOnly === true,
      parentProvider: GITHUB_PARENT_PROVIDER,
      providerId: "github",
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
  registry: ToolRegistry | ToolRegistry[]
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
  if (toRemove.length === 0) {
    return { ok: false, error: "no GitHub MCP connection attached" };
  }
  let removed = 0;
  for (const c of toRemove) {
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }
  return {
    ok: true,
    output: `Disconnected GitHub MCP. Removed ${removed} tools from ${toRemove.length} connection(s).`,
  };
}
