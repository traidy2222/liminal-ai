/**
 * Restore Google Workspace MCP + sidecar after harness startup.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getGoogleAccessToken,
  listGoogleOAuthAccounts,
} from "@liminal/core";
import { listConnectionsByParent } from "./api_connections_store.js";
import { connectGoogleWorkspaceFromServer } from "./connect_provider.js";
import { ensureGoogleSidecarRunning } from "./google_sidecar.js";

const PARENT = "google_workspace";

/** Start sidecar when a persisted google_ext connection exists; optionally auto-connect all services. */
export async function bootstrapGoogleWorkspace(registry: ToolRegistry): Promise<void> {
  const accounts = await listGoogleOAuthAccounts();
  const googleConns = await listConnectionsByParent(PARENT);

  if (googleConns.some((c) => c.sidecarManaged)) {
    const accountId = googleConns.find((c) => c.oauthAccountId)?.oauthAccountId;
    const token = await getGoogleAccessToken(accountId);
    await ensureGoogleSidecarRunning(token ?? undefined);
  }

  const onBoot = effectiveHarnessEnvRaw("AGENT_GOOGLE_CONNECT_ON_BOOT") === "1";
  if (onBoot && accounts.length > 0 && googleConns.length === 0) {
    await connectGoogleWorkspaceFromServer(registry, { mode: "read_write" });
  }
}
