import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { StripeMode } from "./stripe_oauth_scopes.js";

export type StripeConnectResult = {
  accountId: string;
  email?: string;
  stripeUserId?: string;
  livemode?: boolean;
  scopes: string[];
};

export interface RunStripeHostedConnectOptions {
  siteOrigin?: string;
  mode?: StripeMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runStripeHostedConnectFlow(
  options: RunStripeHostedConnectOptions = {}
): Promise<StripeConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "stripe",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    stripeUserId: (r.metadata as { stripeUserId?: string } | undefined)?.stripeUserId,
    livemode: (r.metadata as { livemode?: boolean } | undefined)?.livemode,
    scopes: r.scopes ?? [],
  }));
}
