/**
 * Restore Google Workspace MCP + sidecar after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getGoogleAccessToken,
  listGoogleOAuthAccounts,
  workspaceMcpToolNamesForServices,
  type GoogleServiceId,
} from "@liminal/core";
import { listConnectionsByParent } from "./api_connections_store.js";
import { connectGoogleWorkspaceFromServer } from "./connect_provider.js";
import { ensureGoogleSidecarRunning } from "./google_sidecar.js";

const PARENT = "google_workspace";

export type IntegrationBootstrapOptions = {
  /** When false, skip AGENT_GOOGLE_CONNECT_ON_BOOT auto-attach (use after disconnect / refresh). */
  autoConnect?: boolean;
};

/** Start sidecar when a persisted google_ext connection exists; optionally auto-connect all services. */
export async function bootstrapGoogleWorkspace(
  registry: ToolRegistry,
  opts: IntegrationBootstrapOptions = {}
): Promise<void> {
  const autoConnect = opts.autoConnect !== false;
  const accounts = await listGoogleOAuthAccounts();
  const googleConns = await listConnectionsByParent(PARENT);

  if (googleConns.some((c) => c.sidecarManaged)) {
    const extConn = googleConns.find((c) => c.sidecarManaged);
    const accountId = extConn?.oauthAccountId ?? googleConns.find((c) => c.oauthAccountId)?.oauthAccountId;
    const token = await getGoogleAccessToken(accountId);
    const sidecarServices = (extConn?.services ?? []) as GoogleServiceId[];
    await ensureGoogleSidecarRunning(token ?? undefined, {
      tools: workspaceMcpToolNamesForServices(sidecarServices),
      readOnly: extConn?.readOnly,
    });
  }

  const onBoot = effectiveHarnessEnvRaw("AGENT_GOOGLE_CONNECT_ON_BOOT") === "1";
  if (autoConnect && onBoot && accounts.length > 0 && googleConns.length === 0) {
    await connectGoogleWorkspaceFromServer(registry, { mode: "read_write" });
  }
}
