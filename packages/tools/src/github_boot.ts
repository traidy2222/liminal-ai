/**
 * Attach GitHub MCP on harness startup when GITHUB_TOKEN is configured.
 */
import type { ToolRegistry } from "@liminal/core";
import { readConnection } from "./api_connections_store.js";
import {
  connectGithubMcp,
  githubAuthAvailable,
  GITHUB_MCP_CONNECTION_NAME,
  githubConnectOnBoot,
  githubMcpEnabled,
} from "./github_connect.js";

export type IntegrationBootstrapOptions = {
  /** When false, skip GITHUB_TOKEN boot attach (use after disconnect / refresh). */
  autoConnect?: boolean;
};

export async function bootstrapGithub(
  registry: ToolRegistry,
  opts: IntegrationBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  if (!autoConnect || !githubMcpEnabled() || !githubConnectOnBoot()) return;
  const existing = await readConnection(GITHUB_MCP_CONNECTION_NAME);
  if (existing?.kind === "mcp") return;
  if (!(await githubAuthAvailable())) return;
  await connectGithubMcp(registry);
}
