/**
 * Hosted Microsoft 365 OAuth — opens vireondynamics.com/connect/microsoft.
 */
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { MicrosoftConnectResult } from "./microsoft_connect.js";

export interface RunMicrosoftHostedConnectOptions {
  siteOrigin?: string;
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted Microsoft OAuth; resolves when tokens are POSTed back. */
export function runMicrosoftHostedConnectFlow(
  options: RunMicrosoftHostedConnectOptions = {}
): Promise<MicrosoftConnectResult> {
  const extra: Record<string, string> = {};
  if (options.services?.length) {
    extra.services = options.services.join(",");
  }
  return runHostedIntegrationConnectFlow({
    provider: "microsoft",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    extra: Object.keys(extra).length > 0 ? extra : undefined,
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    scopes: r.scopes ?? [],
  }));
}
