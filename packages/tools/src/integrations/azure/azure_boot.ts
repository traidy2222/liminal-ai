/**
 * Restore Azure MCP sidecar + connections after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  listAzureOAuthAccounts,
  AZURE_MCP_CONNECTION,
} from "@liminal/core";
import { listConnectionsByParent } from "../external_api/api_connections_store.js";
import { connectAzureFromServer } from "../core/connect_provider.js";
import { ensureAzureSidecarRunning } from "./azure_sidecar.js";

const PARENT = "azure";

export type IntegrationBootstrapOptions = {
  autoConnect?: boolean;
};

export async function bootstrapAzure(
  registry: ToolRegistry,
  opts: IntegrationBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  const accounts = await listAzureOAuthAccounts();
  const azConns = await listConnectionsByParent(PARENT);

  if (azConns.some((c) => c.sidecarManaged)) {
    await ensureAzureSidecarRunning();
  }

  const onBoot = effectiveHarnessEnvRaw("AGENT_AZURE_CONNECT_ON_BOOT") === "1";
  if (!autoConnect || !onBoot) return;
  if (accounts.length === 0) return;

  if (azConns.length === 0 || !azConns.some((c) => c.name === AZURE_MCP_CONNECTION)) {
    try {
      await connectAzureFromServer(registry, { mode: "read_write" });
    } catch {
      /* attach can be retried from Integrations */
    }
  }
}
