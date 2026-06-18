import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";

export interface RunYoutubeHostedConnectOptions {
  siteOrigin?: string;
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runYoutubeHostedConnectFlow(
  options: RunYoutubeHostedConnectOptions = {}
): Promise<{
  accountId: string;
  email?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}> {
  return runHostedIntegrationConnectFlow({
    provider: "youtube",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  });
}
