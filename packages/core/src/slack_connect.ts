import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { SlackMode } from "./slack_oauth_scopes.js";

export type SlackConnectResult = {
  accountId: string;
  email?: string;
  teamName?: string;
  scopes: string[];
};

export interface RunSlackHostedConnectOptions {
  siteOrigin?: string;
  mode?: SlackMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runSlackHostedConnectFlow(
  options: RunSlackHostedConnectOptions = {}
): Promise<SlackConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "slack",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    teamName: (r.metadata as { teamName?: string } | undefined)?.teamName,
    scopes: r.scopes ?? [],
  }));
}
