/**
 * Restore Microsoft 365 MCP sidecar + connections after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getMicrosoftAccessToken,
  listMicrosoftOAuthAccounts,
  MICROSOFT_GRAPH_CONNECTION,
  type MicrosoftServiceId,
} from "@liminal/core";
import { listConnectionsByParent } from "./api_connections_store.js";
import { connectMicrosoft365FromServer } from "./connect_provider.js";
import { ensureMicrosoftSidecarRunning } from "./microsoft_sidecar.js";

const PARENT = "microsoft_365";

/** Daily-workflow Graph services to auto-attach when OAuth exists but MCP is partial. */
const CORE_AUTO_ATTACH_SERVICES: MicrosoftServiceId[] = ["mail", "calendar"];

export type IntegrationBootstrapOptions = {
  /** When false, skip AGENT_MICROSOFT_CONNECT_ON_BOOT auto-attach (use after disconnect / refresh). */
  autoConnect?: boolean;
};

export async function bootstrapMicrosoft365(
  registry: ToolRegistry,
  opts: IntegrationBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  const accounts = await listMicrosoftOAuthAccounts();
  const msConns = await listConnectionsByParent(PARENT);

  if (msConns.some((c) => c.sidecarManaged)) {
    const extConn = msConns.find((c) => c.sidecarManaged);
    const accountId = extConn?.oauthAccountId ?? msConns.find((c) => c.oauthAccountId)?.oauthAccountId;
    const token = await getMicrosoftAccessToken(accountId);
    await ensureMicrosoftSidecarRunning(token ?? undefined, {
      readOnly: extConn?.readOnly,
    });
  }

  const onBoot = effectiveHarnessEnvRaw("AGENT_MICROSOFT_CONNECT_ON_BOOT") === "1";
  if (!autoConnect || !onBoot || accounts.length === 0) return;

  if (msConns.length === 0) {
    try {
      await connectMicrosoft365FromServer(registry, { mode: "read_write" });
    } catch {
      /* attach can be retried from Integrations */
    }
    return;
  }

  const graphConn = msConns.find((c) => c.name === MICROSOFT_GRAPH_CONNECTION);
  const attachedServices = new Set((graphConn?.services ?? []) as MicrosoftServiceId[]);
  const missingCore = CORE_AUTO_ATTACH_SERVICES.filter((sid) => !attachedServices.has(sid));
  if (missingCore.length > 0) {
    try {
      await connectMicrosoft365FromServer(registry, {
        services: missingCore,
        mode: "read_write",
      });
    } catch {
      /* partial attach — user can retry from Integrations */
    }
  }
}
