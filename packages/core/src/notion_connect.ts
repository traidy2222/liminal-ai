import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import type { NotionMode } from "./notion_oauth_scopes.js";

export type NotionConnectResult = {
  accountId: string;
  email?: string;
  workspaceName?: string;
  scopes: string[];
};

export interface RunNotionHostedConnectOptions {
  siteOrigin?: string;
  mode?: NotionMode;
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

export function runNotionHostedConnectFlow(
  options: RunNotionHostedConnectOptions = {}
): Promise<NotionConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "notion",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    workspaceName: (r.metadata as { workspaceName?: string } | undefined)?.workspaceName,
    scopes: r.scopes ?? [],
  }));
}
