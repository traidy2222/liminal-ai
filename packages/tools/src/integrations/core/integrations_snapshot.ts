/**
 * Canonical integrations snapshot for web, desktop sidecar, and settings UI.
 */
import {
  ALL_AZURE_SERVICE_IDS,
  ALL_GOOGLE_SERVICE_IDS,
  ALL_MICROSOFT_SERVICE_IDS,
  listAzureOAuthAccounts,
  listGithubOAuthAccounts,
  listGoogleOAuthAccounts,
  listLinearOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listNotionOAuthAccounts,
  listSlackOAuthAccounts,
  listXeroOAuthAccounts,
  missingDefaultAzureScopes,
  missingDefaultMicrosoftScopes,
  missingDefaultWorkspaceScopes,
  missingSlackScopes,
  refreshStaleXeroAccounts,
  xeroBundleMissingCoreScopes,
  xeroBundleMissingFullScopes,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingScopes,
} from "@liminal/core";
import { getAzureSidecarStatus } from "../azure/azure_sidecar.js";
import { getGoogleSidecarStatus } from "../google/google_sidecar.js";
import { getMicrosoftSidecarStatus } from "../microsoft/microsoft_sidecar.js";
import { listIntegrationConnections, type IntegrationConnectionSummary } from "./integrations_server.js";

export type IntegrationConnectMode = "oauth_mcp" | "oauth_auto_attach" | "custom";

export interface IntegrationProviderStatus {
  id: string;
  connectMode: IntegrationConnectMode;
  signedIn: boolean;
  toolsAttached: boolean;
  toolCount: number;
  ready: boolean;
  accountCount: number;
  needsScopeReconnect: boolean;
}

export interface IntegrationsOAuthAccount {
  accountId: string;
  email?: string;
  scopes: string[];
  expiresAt: number;
  missingScopes?: string[];
}

export interface IntegrationsSidecarStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  pid?: number;
}

export interface IntegrationsSnapshot {
  google: {
    accounts: IntegrationsOAuthAccount[];
    sidecar: IntegrationsSidecarStatus;
    services: string[];
  };
  microsoft: {
    accounts: IntegrationsOAuthAccount[];
    sidecar: IntegrationsSidecarStatus;
    services: string[];
  };
  azure: {
    accounts: IntegrationsOAuthAccount[];
    sidecar: IntegrationsSidecarStatus;
    services: string[];
  };
  github: {
    accounts: Array<IntegrationsOAuthAccount & { login?: string }>;
  };
  xero: {
    accounts: Array<
      IntegrationsOAuthAccount & {
        tenantId?: string;
        tenantName?: string;
        missingCoreScopes?: string[];
        missingFullScopes?: string[];
        missingExtendedScopes?: string[];
      }
    >;
  };
  slack: {
    accounts: Array<
      IntegrationsOAuthAccount & {
        teamId?: string;
        teamName?: string;
      }
    >;
  };
  linear: {
    accounts: Array<
      IntegrationsOAuthAccount & {
        organizationName?: string;
      }
    >;
  };
  notion: {
    accounts: Array<
      IntegrationsOAuthAccount & {
        workspaceId?: string;
        workspaceName?: string;
      }
    >;
  };
  connections: IntegrationConnectionSummary[];
  providerStatus: Record<string, IntegrationProviderStatus>;
}

function toolsForParent(connections: IntegrationConnectionSummary[], parentProvider: string) {
  const rows = connections.filter((c) => c.parentProvider === parentProvider);
  return {
    attached: rows.length > 0,
    toolCount: rows.reduce((n, c) => n + c.toolCount, 0),
  };
}

function accountHasMissingScopes(accounts: IntegrationsOAuthAccount[]): boolean {
  return accounts.some((a) => (a.missingScopes?.length ?? 0) > 0);
}

/** Derive per-provider sign-in vs tools-attached status from a snapshot body. */
export function deriveIntegrationProviderStatuses(
  snapshot: Pick<IntegrationsSnapshot, "connections"> & {
    google: { accounts: IntegrationsOAuthAccount[] };
    microsoft: { accounts: IntegrationsOAuthAccount[] };
    azure: { accounts: IntegrationsOAuthAccount[] };
    github: { accounts: IntegrationsOAuthAccount[] };
    xero: { accounts: Array<IntegrationsOAuthAccount & { missingCoreScopes?: string[] }> };
    slack: { accounts: IntegrationsOAuthAccount[] };
    linear: { accounts: IntegrationsOAuthAccount[] };
    notion: { accounts: IntegrationsOAuthAccount[] };
  }
): Record<string, IntegrationProviderStatus> {
  const { connections } = snapshot;
  const google = toolsForParent(connections, "google_workspace");
  const microsoft = toolsForParent(connections, "microsoft_365");
  const azure = toolsForParent(connections, "azure");
  const github = toolsForParent(connections, "github");

  const oauthAuto = (id: string, accounts: IntegrationsOAuthAccount[], needsScopeReconnect: boolean) => {
    const signedIn = accounts.length > 0;
    return {
      id,
      connectMode: "oauth_auto_attach" as const,
      signedIn,
      toolsAttached: signedIn,
      toolCount: signedIn ? 1 : 0,
      ready: signedIn && !needsScopeReconnect,
      accountCount: accounts.length,
      needsScopeReconnect,
    };
  };

  const oauthMcp = (
    id: string,
    accounts: IntegrationsOAuthAccount[],
    parentProvider: string,
    needsScopeReconnect: boolean
  ) => {
    const tools = toolsForParent(connections, parentProvider);
    const signedIn = accounts.length > 0;
    return {
      id,
      connectMode: "oauth_mcp" as const,
      signedIn,
      toolsAttached: tools.attached,
      toolCount: tools.toolCount,
      ready: tools.attached,
      accountCount: accounts.length,
      needsScopeReconnect,
    };
  };

  return {
    google: oauthMcp("google", snapshot.google.accounts, "google_workspace", accountHasMissingScopes(snapshot.google.accounts)),
    microsoft: oauthMcp(
      "microsoft",
      snapshot.microsoft.accounts,
      "microsoft_365",
      accountHasMissingScopes(snapshot.microsoft.accounts)
    ),
    azure: oauthMcp("azure", snapshot.azure.accounts, "azure", accountHasMissingScopes(snapshot.azure.accounts)),
    github: {
      ...oauthMcp("github", snapshot.github.accounts, "github", false),
      ready: github.attached,
      toolsAttached: github.attached,
      toolCount: github.toolCount,
    },
    xero: oauthAuto(
      "xero",
      snapshot.xero.accounts,
      snapshot.xero.accounts.some((a) => (a.missingCoreScopes?.length ?? 0) > 0)
    ),
    slack: oauthAuto("slack", snapshot.slack.accounts, accountHasMissingScopes(snapshot.slack.accounts)),
    linear: oauthAuto("linear", snapshot.linear.accounts, false),
    notion: oauthAuto("notion", snapshot.notion.accounts, false),
  };
}

export async function buildIntegrationsSnapshot(): Promise<IntegrationsSnapshot> {
  await refreshStaleXeroAccounts();
  const accounts = await listGoogleOAuthAccounts();
  const msAccounts = await listMicrosoftOAuthAccounts();
  const body = {
    google: {
      accounts: accounts.map((a) => ({
        ...a,
        missingScopes: missingDefaultWorkspaceScopes(a.scopes),
      })),
      sidecar: await getGoogleSidecarStatus(),
      services: ALL_GOOGLE_SERVICE_IDS,
    },
    microsoft: {
      accounts: msAccounts.map((a) => ({
        ...a,
        missingScopes: missingDefaultMicrosoftScopes(a.scopes),
      })),
      sidecar: await getMicrosoftSidecarStatus(),
      services: ALL_MICROSOFT_SERVICE_IDS,
    },
    azure: {
      accounts: (await listAzureOAuthAccounts()).map((a) => ({
        ...a,
        missingScopes: missingDefaultAzureScopes(a.scopes),
      })),
      sidecar: await getAzureSidecarStatus(),
      services: ALL_AZURE_SERVICE_IDS,
    },
    github: {
      accounts: (await listGithubOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        login: a.login,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
      })),
    },
    xero: {
      accounts: (await listXeroOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        tenantId: a.tenantId,
        tenantName: a.tenantName,
        missingScopes: xeroBundleMissingScopes(a.scopes),
        missingCoreScopes: xeroBundleMissingCoreScopes(a.scopes),
        missingFullScopes: xeroBundleMissingFullScopes(a.scopes),
        missingExtendedScopes: xeroBundleMissingPhase3Scopes(a.scopes),
      })),
    },
    slack: {
      accounts: (await listSlackOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        teamId: a.teamId,
        teamName: a.teamName,
        missingScopes: missingSlackScopes(a.scopes),
      })),
    },
    linear: {
      accounts: (await listLinearOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        organizationName: a.organizationName,
      })),
    },
    notion: {
      accounts: (await listNotionOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        workspaceId: a.workspaceId,
        workspaceName: a.workspaceName,
      })),
    },
    connections: await listIntegrationConnections(),
  };
  return {
    ...body,
    providerStatus: deriveIntegrationProviderStatuses(body),
  };
}
