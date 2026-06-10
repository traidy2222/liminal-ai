/**
 * Hosted Azure OAuth — opens vireondynamics.com/connect/azure when available.
 */
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";

export interface RunAzureHostedConnectOptions {
  siteOrigin?: string;
  services?: string[];
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export type AzureConnectResult = {
  accountId: string;
  email?: string;
  scopes: string[];
};

export function runAzureHostedConnectFlow(
  options: RunAzureHostedConnectOptions = {}
): Promise<AzureConnectResult> {
  const extra: Record<string, string> = {};
  if (options.services?.length) {
    extra.services = options.services.join(",");
  }
  return runHostedIntegrationConnectFlow({
    provider: "azure",
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
