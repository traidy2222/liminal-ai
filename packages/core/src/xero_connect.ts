/**
 * Hosted Xero OAuth for CLI, desktop sidecar, and TUI — opens vireondynamics.com/connect/xero.
 */
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { XeroMode } from "./xero_oauth_scopes.js";

export type XeroConnectResult = {
  email?: string;
  accountId: string;
  tenantName?: string;
};

export interface RunXeroHostedConnectOptions {
  siteOrigin?: string;
  mode?: XeroMode;
  /** Request files, projects, payroll, GL journal scopes (default false). */
  extended?: boolean;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted Xero OAuth; resolves when tokens are POSTed back. */
export function runXeroHostedConnectFlow(
  options: RunXeroHostedConnectOptions = {}
): Promise<XeroConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "xero",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    extra: options.extended ? { extended: "1" } : undefined,
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    email: r.email,
    accountId: r.accountId,
    tenantName: (r.metadata as { tenantName?: string } | undefined)?.tenantName,
  }));
}
