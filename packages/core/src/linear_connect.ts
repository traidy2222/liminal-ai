import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { LinearMode } from "./linear_oauth_scopes.js";

export type LinearConnectResult = {
  accountId: string;
  email?: string;
  organizationName?: string;
  scopes: string[];
};

export interface RunLinearHostedConnectOptions {
  siteOrigin?: string;
  mode?: LinearMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runLinearHostedConnectFlow(
  options: RunLinearHostedConnectOptions = {}
): Promise<LinearConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "linear",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    organizationName: (r.metadata as { organizationName?: string } | undefined)?.organizationName,
    scopes: r.scopes ?? [],
  }));
}
