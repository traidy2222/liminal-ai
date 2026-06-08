/**
 * Hosted GitHub OAuth — opens vireondynamics.com/connect/github.
 */
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";

export type GithubConnectResult = {
  accountId: string;
  email?: string;
  login?: string;
  scopes: string[];
};

export interface RunGithubHostedConnectOptions {
  siteOrigin?: string;
  mode?: "read_write" | "read_only";
  openBrowser?: boolean;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
}

/** Loopback server + browser to Vireon-hosted GitHub OAuth; resolves when tokens are POSTed back. */
export function runGithubHostedConnectFlow(
  options: RunGithubHostedConnectOptions = {}
): Promise<GithubConnectResult> {
  return runHostedIntegrationConnectFlow({
    provider: "github",
    siteOrigin: options.siteOrigin,
    mode: options.mode ?? "read_write",
    openBrowser: options.openBrowser,
    onStatus: options.onStatus,
    timeoutMs: options.timeoutMs,
  }).then((r) => ({
    accountId: r.accountId,
    email: r.email,
    login: (r.metadata as { login?: string } | undefined)?.login,
    scopes: r.scopes ?? [],
  }));
}
