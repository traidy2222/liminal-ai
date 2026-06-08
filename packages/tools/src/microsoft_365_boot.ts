/**
 * Restore Microsoft 365 MCP sidecar + connections after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getMicrosoftAccessToken,
  listMicrosoftOAuthAccounts,
  type MicrosoftServiceId,
} from "@liminal/core";
import { listConnectionsByParent } from "./api_connections_store.js";
import { connectMicrosoft365FromServer } from "./connect_provider.js";
import { ensureMicrosoftSidecarRunning } from "./microsoft_sidecar.js";

const PARENT = "microsoft_365";

export async function bootstrapMicrosoft365(registry: ToolRegistry): Promise<void> {
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
  if (onBoot && accounts.length > 0 && msConns.length === 0) {
    try {
      await connectMicrosoft365FromServer(registry, { mode: "read_write" });
    } catch {
      /* attach can be retried from Integrations */
    }
  }
}
