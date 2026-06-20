/**
 * Restore AWS MCP connections after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import { effectiveHarnessEnvRaw, listAwsIdentityAccounts } from "@liminal/core";
import { listConnectionsByParent } from "../external_api/api_connections_store.js";
import { connectAwsFromServer, awsIdentityReady } from "./aws_connect.js";

const PARENT = "aws";

export type IntegrationBootstrapOptions = {
  autoConnect?: boolean;
};

export async function bootstrapAws(
  registry: ToolRegistry,
  opts: IntegrationBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  const onBoot = effectiveHarnessEnvRaw("AGENT_AWS_CONNECT_ON_BOOT") === "1";
  if (!autoConnect || !onBoot) return;
  if (!(await awsIdentityReady())) return;
  const conns = await listConnectionsByParent(PARENT);
  if (conns.length > 0) return;
  const accounts = await listAwsIdentityAccounts();
  if (accounts.length === 0) return;
  try {
    await connectAwsFromServer(registry, { mode: "read_write" });
  } catch {
    /* retry from Integrations UI */
  }
}
