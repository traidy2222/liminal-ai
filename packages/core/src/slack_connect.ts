import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import { SLACK_DEFAULT_MODE, slackHostedConnectExtra, type SlackMode } from "./slack_oauth_scopes.js";

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
  const mode = options.mode ?? SLACK_DEFAULT_MODE;
  return runHostedIntegrationConnectFlow({
    provider: "slack",
    siteOrigin: options.siteOrigin,
    mode,
    extra: slackHostedConnectExtra(mode),
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
