/**
 * Canonical integrations snapshot for web, desktop sidecar, and settings UI.
 */
import {
  ALL_AWS_SERVICE_IDS,
  AWS_SERVICE_GROUPS,
  DEFAULT_AWS_SERVICE_IDS,
  ALL_AZURE_SERVICE_IDS,
  ALL_GOOGLE_SERVICE_IDS,
  ALL_MICROSOFT_SERVICE_IDS,
  DEFAULT_GOOGLE_SERVICE_IDS,
  DEFAULT_MICROSOFT_SERVICE_IDS,
  GOOGLE_CONNECT_PRESETS,
  GOOGLE_SERVICE_GROUPS,
  MICROSOFT_CONNECT_PRESETS,
  MICROSOFT_SERVICE_GROUPS,
  listAzureOAuthAccounts,
  listGithubOAuthAccounts,
  listGoogleOAuthAccounts,
  listLinearOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listNotionOAuthAccounts,
  listYoutubeOAuthAccounts,
  missingYoutubeScopes,
  youtubeConnectOptionsFromMetadata,
  listSlackOAuthAccounts,
  listXeroOAuthAccounts,
  listAwsIdentityAccounts,
  missingDefaultAzureScopes,
  missingGoogleScopes,
  missingMicrosoftScopes,
  missingSlackScopes,
  resolveGoogleServices,
  resolveMicrosoftServices,
  refreshStaleXeroAccounts,
  xeroBundleMissingCoreScopes,
  xeroBundleMissingFullScopes,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingScopes,
  effectiveHarnessEnvRaw,
} from "@liminal/core";
import { getAzureSidecarStatus } from "../azure/azure_sidecar.js";
import { getAwsIntegrationStatus } from "../aws/aws_connect.js";
import { getGoogleSidecarStatus } from "../google/google_sidecar.js";
import { getMicrosoftSidecarStatus } from "../microsoft/microsoft_sidecar.js";
import { getIdaSidecarStatus } from "../ida/ida_sidecar.js";
import { idaMcpEnabled } from "../ida/ida_connect.js";
import { idaGuiMcpUrl, probeIdaMcpInitialize } from "../ida/ida_probe.js";
import { listIntegrationConnections, type IntegrationConnectionSummary } from "./integrations_server.js";
import {
  buildWorkspaceServiceCards,
  type IntegrationServiceCard,
} from "./workspace_service_cards.js";

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
  aws: {
    accounts: IntegrationsOAuthAccount[];
    sidecar: IntegrationsSidecarStatus;
    services: string[];
    defaultServices: string[];
    serviceGroups: typeof AWS_SERVICE_GROUPS;
  };
  github: {
    accounts: Array<IntegrationsOAuthAccount & { login?: string }>;
  };
  ida: {
    sidecar: IntegrationsSidecarStatus;
    enabled: boolean;
    guiReachable: boolean;
    mcpUrlOverride?: string;
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
  youtube: {
    accounts: Array<
      IntegrationsOAuthAccount & {
        channelId?: string;
        channelTitle?: string;
        customUrl?: string;
        connectMode?: "read_write" | "read_only";
        monetaryRequested?: boolean;
      }
    >;
  };
  connections: IntegrationConnectionSummary[];
  providerStatus: Record<string, IntegrationProviderStatus>;
  serviceCards: {
    google: IntegrationServiceCard[];
    microsoft: IntegrationServiceCard[];
    aws: IntegrationServiceCard[];
  };
}

function toolsForParent(connections: IntegrationConnectionSummary[], parentProvider: string) {
  const rows = connections.filter((c) => c.parentProvider === parentProvider);
  return {
    attached: rows.length > 0,
    toolCount: rows.reduce((n, c) => n + c.toolCount, 0),
  };
}

function collectAttachedServiceIds(
  connections: IntegrationConnectionSummary[],
  parentProvider: string
): string[] {
  const ids = new Set<string>();
  for (const c of connections) {
    if (c.parentProvider !== parentProvider) continue;
    for (const s of c.services ?? []) ids.add(s);
  }
  return [...ids];
}

function missingScopesForGoogleAccount(
  scopes: string[],
  connections: IntegrationConnectionSummary[]
): string[] {
  const attached = collectAttachedServiceIds(connections, "google_workspace");
  const serviceIds = attached.length > 0 ? attached : DEFAULT_GOOGLE_SERVICE_IDS;
  return missingGoogleScopes(scopes, resolveGoogleServices(serviceIds));
}

function missingScopesForMicrosoftAccount(
  scopes: string[],
  connections: IntegrationConnectionSummary[]
): string[] {
  const attached = collectAttachedServiceIds(connections, "microsoft_365");
  const serviceIds = attached.length > 0 ? attached : DEFAULT_MICROSOFT_SERVICE_IDS;
  return missingMicrosoftScopes(scopes, resolveMicrosoftServices(serviceIds));
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
    aws: { accounts: IntegrationsOAuthAccount[] };
    github: { accounts: IntegrationsOAuthAccount[] };
    xero: { accounts: Array<IntegrationsOAuthAccount & { missingCoreScopes?: string[] }> };
    slack: { accounts: IntegrationsOAuthAccount[] };
    linear: { accounts: IntegrationsOAuthAccount[] };
    notion: { accounts: IntegrationsOAuthAccount[] };
    youtube: { accounts: IntegrationsOAuthAccount[] };
    ida: {
      sidecar: IntegrationsSidecarStatus;
      enabled: boolean;
      guiReachable: boolean;
      mcpUrlOverride?: string;
    };
  }
): Record<string, IntegrationProviderStatus> {
  const { connections } = snapshot;
  const google = toolsForParent(connections, "google_workspace");
  const microsoft = toolsForParent(connections, "microsoft_365");
  const azure = toolsForParent(connections, "azure");
  const aws = toolsForParent(connections, "aws");
  const github = toolsForParent(connections, "github");
  const ida = toolsForParent(connections, "ida");

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

  const oauthAutoAttachWorkspace = (
    id: string,
    accounts: IntegrationsOAuthAccount[],
    parentProvider: string,
    needsScopeReconnect: boolean
  ) => {
    const tools = toolsForParent(connections, parentProvider);
    const signedIn = accounts.length > 0;
    return {
      id,
      connectMode: "oauth_auto_attach" as const,
      signedIn,
      toolsAttached: signedIn || tools.attached,
      toolCount: tools.attached ? tools.toolCount : signedIn ? 1 : 0,
      ready: signedIn && !needsScopeReconnect,
      accountCount: accounts.length,
      needsScopeReconnect,
    };
  };

  return {
    google: oauthAutoAttachWorkspace(
      "google",
      snapshot.google.accounts,
      "google_workspace",
      accountHasMissingScopes(snapshot.google.accounts)
    ),
    microsoft: oauthAutoAttachWorkspace(
      "microsoft",
      snapshot.microsoft.accounts,
      "microsoft_365",
      accountHasMissingScopes(snapshot.microsoft.accounts)
    ),
    azure: oauthMcp("azure", snapshot.azure.accounts, "azure", accountHasMissingScopes(snapshot.azure.accounts)),
    aws: {
      id: "aws",
      connectMode: "custom" as const,
      signedIn: snapshot.aws.accounts.length > 0,
      toolsAttached: aws.attached,
      toolCount: aws.toolCount,
      ready: aws.attached,
      accountCount: snapshot.aws.accounts.length,
      needsScopeReconnect: false,
    },
    github: {
      ...oauthMcp("github", snapshot.github.accounts, "github", false),
      ready: github.attached,
      toolsAttached: github.attached,
      toolCount: github.toolCount,
    },
    ida: {
      id: "ida",
      connectMode: "custom" as const,
      signedIn:
        snapshot.ida.enabled &&
        (snapshot.ida.sidecar.running ||
          snapshot.ida.guiReachable ||
          Boolean(snapshot.ida.mcpUrlOverride)),
      toolsAttached: ida.attached,
      toolCount: ida.toolCount,
      ready: ida.attached,
      accountCount: 0,
      needsScopeReconnect: false,
    },
    xero: oauthAuto(
      "xero",
      snapshot.xero.accounts,
      snapshot.xero.accounts.some((a) => (a.missingCoreScopes?.length ?? 0) > 0)
    ),
    slack: oauthAuto("slack", snapshot.slack.accounts, accountHasMissingScopes(snapshot.slack.accounts)),
    linear: oauthAuto("linear", snapshot.linear.accounts, false),
    notion: oauthAuto("notion", snapshot.notion.accounts, false),
    youtube: oauthAuto("youtube", snapshot.youtube.accounts, accountHasMissingScopes(snapshot.youtube.accounts)),
  };
}

export async function buildIntegrationsSnapshot(): Promise<IntegrationsSnapshot> {
  await refreshStaleXeroAccounts();
  const connections = await listIntegrationConnections();
  const accounts = await listGoogleOAuthAccounts();
  const msAccounts = await listMicrosoftOAuthAccounts();
  const body = {
    google: {
      accounts: accounts.map((a) => ({
        ...a,
        missingScopes: missingScopesForGoogleAccount(a.scopes, connections),
      })),
      sidecar: await getGoogleSidecarStatus(),
      services: ALL_GOOGLE_SERVICE_IDS,
      defaultServices: DEFAULT_GOOGLE_SERVICE_IDS,
      serviceGroups: GOOGLE_SERVICE_GROUPS,
      connectPresets: GOOGLE_CONNECT_PRESETS,
    },
    microsoft: {
      accounts: msAccounts.map((a) => ({
        ...a,
        missingScopes: missingScopesForMicrosoftAccount(a.scopes, connections),
      })),
      sidecar: await getMicrosoftSidecarStatus(),
      services: ALL_MICROSOFT_SERVICE_IDS,
      defaultServices: DEFAULT_MICROSOFT_SERVICE_IDS,
      serviceGroups: MICROSOFT_SERVICE_GROUPS,
      connectPresets: MICROSOFT_CONNECT_PRESETS,
    },
    azure: {
      accounts: (await listAzureOAuthAccounts()).map((a) => ({
        ...a,
        missingScopes: missingDefaultAzureScopes(a.scopes),
      })),
      sidecar: await getAzureSidecarStatus(),
      services: ALL_AZURE_SERVICE_IDS,
    },
    aws: {
      accounts: (await listAwsIdentityAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.label ?? a.arn,
        scopes: [] as string[],
        expiresAt: 0,
      })),
      sidecar: await getAwsIntegrationStatus(),
      services: ALL_AWS_SERVICE_IDS,
      defaultServices: DEFAULT_AWS_SERVICE_IDS,
      serviceGroups: AWS_SERVICE_GROUPS,
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
    ida: {
      sidecar: await getIdaSidecarStatus(),
      enabled: idaMcpEnabled(),
      guiReachable: (await probeIdaMcpInitialize(idaGuiMcpUrl())).ok,
      mcpUrlOverride: effectiveHarnessEnvRaw("AGENT_IDA_MCP_URL")?.trim() || undefined,
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
    youtube: {
      accounts: (await listYoutubeOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        missingScopes: missingYoutubeScopes(
          a.scopes,
          youtubeConnectOptionsFromMetadata(
            { mode: a.connectMode, monetary: a.monetaryRequested },
            a.connectMode ?? "read_write"
          )
        ),
        connectMode: a.connectMode,
        monetaryRequested: a.monetaryRequested,
        channelId: a.channelId,
        channelTitle: a.channelTitle,
        customUrl: a.customUrl,
      })),
    },
    connections,
  };
  return {
    ...body,
    serviceCards: buildWorkspaceServiceCards({
      googleAccounts: body.google.accounts,
      microsoftAccounts: body.microsoft.accounts,
      azureAccounts: body.azure.accounts,
      awsAccounts: body.aws.accounts,
      connections,
    }),
    providerStatus: deriveIntegrationProviderStatuses(body),
  };
}
