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
  /** Request files, projects, payroll scopes (default false). */
  extended?: boolean;
  /** Include reports + budgets on authorize (granular full tier). */
  fullScopes?: boolean;
  /** GL journals — requires Xero developer approval on many apps. */
  journals?: boolean;
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
    extra: {
      ...(options.extended ? { extended: "1" } : {}),
      ...(options.fullScopes ? { full_scopes: "1" } : {}),
      ...(options.journals ? { journals: "1" } : {}),
    },
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    email: r.email,
    accountId: r.accountId,
    tenantName: (r.metadata as { tenantName?: string } | undefined)?.tenantName,
  }));
}
