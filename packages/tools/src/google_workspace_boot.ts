/**
 * Restore Google Workspace MCP + sidecar after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getGoogleAccessToken,
  getGoogleServicePreset,
  listGoogleOAuthAccounts,
  workspaceMcpToolNamesForServices,
  type GoogleServiceId,
} from "@liminal/core";
import { listConnectionsByParent } from "./api_connections_store.js";
import { connectGoogleWorkspaceFromServer } from "./connect_provider.js";
import { ensureGoogleSidecarRunning } from "./google_sidecar.js";

const PARENT = "google_workspace";

/** Core daily-workflow services to auto-attach when OAuth exists but MCP is partial. */
const CORE_AUTO_ATTACH_SERVICES: GoogleServiceId[] = ["gmail", "calendar"];

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
  if (!autoConnect || !onBoot || accounts.length === 0) return;

  const attachedNames = new Set(googleConns.map((c) => c.name));
  if (googleConns.length === 0) {
    await connectGoogleWorkspaceFromServer(registry, { mode: "read_write" });
    return;
  }

  const missingCore = CORE_AUTO_ATTACH_SERVICES.filter((sid) => {
    const preset = getGoogleServicePreset(sid);
    return preset?.connectionName && !attachedNames.has(preset.connectionName);
  });
  if (missingCore.length > 0) {
    await connectGoogleWorkspaceFromServer(registry, {
      services: missingCore,
      mode: "read_write",
    });
  }
}
