/**
 * Attach IDA MCP on harness startup when AGENT_IDA_CONNECT_ON_BOOT=1.
 */
import type { ToolRegistry } from "@liminal/core";
import { readConnection } from "../external_api/api_connections_store.js";
import {
  connectIdaMcp,
  IDA_MCP_CONNECTION_NAME,
  idaConnectOnBoot,
  idaMcpEnabled,
} from "./ida_connect.js";

export type IdaBootstrapOptions = {
  autoConnect?: boolean;
};

export async function bootstrapIda(
  registry: ToolRegistry,
  opts: IdaBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  if (!autoConnect || !idaMcpEnabled() || !idaConnectOnBoot()) return;
  const existing = await readConnection(IDA_MCP_CONNECTION_NAME);
  if (existing?.kind === "mcp") return;
  const result = await connectIdaMcp(registry);
  if (!result.ok) {
    throw new Error(result.error);
  }
}
