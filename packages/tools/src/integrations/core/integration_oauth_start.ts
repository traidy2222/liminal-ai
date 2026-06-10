/**
 * Hosted OAuth bootstrap for connect_provider({ start_oauth: true }).
 */
import {
  listGoogleOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listXeroOAuthAccounts,
  listGithubOAuthAccounts,
  listSlackOAuthAccounts,
  listLinearOAuthAccounts,
  listNotionOAuthAccounts,
  listAzureOAuthAccounts,
  runGoogleHostedConnectFlow,
  runMicrosoftHostedConnectFlow,
  runAzureHostedConnectFlow,
  runGithubHostedConnectFlow,
  runXeroHostedConnectFlow,
  runSlackHostedConnectFlow,
  runLinearHostedConnectFlow,
  runNotionHostedConnectFlow,
} from "@liminal/core";
import { githubAuthAvailable, githubTokenPresent } from "../github/github_connect.js";

export type ConnectProviderId =
  | "google_workspace"
  | "microsoft_365"
  | "azure"
  | "xero"
  | "github"
  | "slack"
  | "linear"
  | "notion";

const PROVIDER_LABEL: Record<ConnectProviderId, string> = {
  google_workspace: "Google Workspace",
  microsoft_365: "Microsoft 365",
  azure: "Azure",
  xero: "Xero",
  github: "GitHub",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
};

export function integrationNotConnectedError(provider: ConnectProviderId, label?: string): string {
  const name = label ?? PROVIDER_LABEL[provider] ?? provider;
  return (
    `${name} not connected. Call connect_provider({ provider: "${provider}", start_oauth: true }) ` +
    `to open sign-in in the browser, wait for completion, then retry your request.`
  );
}

export async function isConnectProviderOAuthReady(provider: ConnectProviderId): Promise<boolean> {
  switch (provider) {
    case "google_workspace":
      return (await listGoogleOAuthAccounts()).length > 0;
    case "microsoft_365":
      return (await listMicrosoftOAuthAccounts()).length > 0;
    case "azure":
      return (await listAzureOAuthAccounts()).length > 0;
    case "xero":
      return (await listXeroOAuthAccounts()).length > 0;
    case "slack":
      return (await listSlackOAuthAccounts()).length > 0;
    case "linear":
      return (await listLinearOAuthAccounts()).length > 0;
    case "notion":
      return (await listNotionOAuthAccounts()).length > 0;
    case "github":
      return await githubAuthAvailable();
  }
}

export async function startConnectProviderOAuth(
  provider: ConnectProviderId,
  opts: {
    mode?: "read_write" | "read_only";
    services?: string[];
    onStatus?: (message: string) => void;
  } = {}
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const mode = opts.mode ?? "read_write";
  const onStatus = opts.onStatus ?? (() => {});
  const flowOpts = {
    mode,
    openBrowser: true,
    onStatus,
    services: opts.services,
  };

  try {
    onStatus(`Opening browser for ${PROVIDER_LABEL[provider]} sign-in…`);
    switch (provider) {
      case "google_workspace": {
        const r = await runGoogleHostedConnectFlow(flowOpts);
        return { ok: true, label: r.email ?? r.accountId };
      }
      case "microsoft_365": {
        const r = await runMicrosoftHostedConnectFlow(flowOpts);
        return { ok: true, label: r.email ?? r.accountId };
      }
      case "azure": {
        const r = await runAzureHostedConnectFlow(flowOpts);
        return { ok: true, label: r.email ?? r.accountId };
      }
      case "xero": {
        const r = await runXeroHostedConnectFlow(flowOpts);
        const tenant = r.tenantName ? ` · ${r.tenantName}` : "";
        return { ok: true, label: `${r.email ?? r.accountId}${tenant}` };
      }
      case "github": {
        const r = await runGithubHostedConnectFlow(flowOpts);
        return { ok: true, label: r.login ?? r.email ?? r.accountId };
      }
      case "slack": {
        const r = await runSlackHostedConnectFlow(flowOpts);
        return { ok: true, label: r.teamName ?? r.email ?? r.accountId };
      }
      case "linear": {
        const r = await runLinearHostedConnectFlow(flowOpts);
        return { ok: true, label: r.organizationName ?? r.email ?? r.accountId };
      }
      case "notion": {
        const r = await runNotionHostedConnectFlow(flowOpts);
        return { ok: true, label: r.workspaceName ?? r.email ?? r.accountId };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (provider === "github" && githubTokenPresent()) {
      return { ok: true, label: "GITHUB_TOKEN env" };
    }
    return { ok: false, error: `${PROVIDER_LABEL[provider]} sign-in failed: ${msg}` };
  }
}

export function isConnectProviderId(value: string): value is ConnectProviderId {
  return (
    value === "google_workspace" ||
    value === "microsoft_365" ||
    value === "azure" ||
    value === "xero" ||
    value === "github" ||
    value === "slack" ||
    value === "linear" ||
    value === "notion"
  );
}
