/**
 * Hosted Google Workspace OAuth — opens vireondynamics.com/connect/google.
 */
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { GoogleConnectResult } from "./google_connect.js";

export interface RunGoogleHostedConnectOptions {
  siteOrigin?: string;
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted Google OAuth; resolves when tokens are POSTed back. */
export function runGoogleHostedConnectFlow(
  options: RunGoogleHostedConnectOptions = {}
): Promise<GoogleConnectResult> {
  const extra: Record<string, string> = {};
  if (options.services?.length) {
    extra.services = options.services.join(",");
  }
  return runHostedIntegrationConnectFlow({
    provider: "google",
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
