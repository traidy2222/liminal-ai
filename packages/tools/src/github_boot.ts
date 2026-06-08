/**
 * Attach GitHub MCP on harness startup when GITHUB_TOKEN is configured.
 */
import type { ToolRegistry } from "@liminal/core";
import { readConnection } from "./api_connections_store.js";
import {
  connectGithubMcp,
  GITHUB_MCP_CONNECTION_NAME,
  githubConnectOnBoot,
  githubMcpEnabled,
} from "./github_connect.js";

export async function bootstrapGithub(registry: ToolRegistry): Promise<void> {
  if (!githubMcpEnabled() || !githubConnectOnBoot()) return;
  const existing = await readConnection(GITHUB_MCP_CONNECTION_NAME);
  if (existing?.kind === "mcp") return;
  await connectGithubMcp(registry);
}
