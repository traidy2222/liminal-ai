/**
 * Per-service integration cards — one OAuth scope bundle + attach surface per card.
 */
import {
  AZURE_MCP_CONNECTION,
  GOOGLE_REST_SERVICE_IDS,
  GOOGLE_SERVICE_GROUPS,
  GOOGLE_WORKSPACE_SERVICES,
  MICROSOFT_GRAPH_CONNECTION,
  MICROSOFT_SERVICE_GROUPS,
  MICROSOFT_WORKSPACE_SERVICES,
  getGoogleServicePreset,
  getMicrosoftServicePreset,
  getAzureServicePreset,
  missingGoogleScopes,
  missingMicrosoftScopes,
  missingAzureScopes,
  resolveGoogleServices,
  resolveMicrosoftServices,
  resolveAzureServices,
  AWS_MCP_CONNECTION,
  AWS_SERVICE_GROUPS,
  AWS_WORKSPACE_SERVICES,
  getAwsServicePreset,
  type GoogleServiceId,
  type MicrosoftServiceId,
  type AzureServiceId,
  type AwsServiceId,
} from "@liminal/core";
import type { IntegrationConnectionSummary } from "./integrations_server.js";
import type { IntegrationsOAuthAccount } from "./integrations_snapshot.js";

export type ServiceCardCategory = "google" | "microsoft" | "aws";

export interface IntegrationServiceCard {
  category: ServiceCardCategory;
  vendor: "google" | "microsoft" | "azure" | "aws";
  serviceId: string;
  label: string;
  groupId: string;
  groupLabel: string;
  signedIn: boolean;
  connected: boolean;
  toolCount: number;
  needsScopeReconnect: boolean;
  restOnly: boolean;
}

function groupMeta(
  groups: Array<{ id: string; label: string; services: string[] }>,
  serviceId: string
): { groupId: string; groupLabel: string } {
  for (const g of groups) {
    if (g.services.includes(serviceId)) {
      return { groupId: g.id, groupLabel: g.label };
    }
  }
  return { groupId: "other", groupLabel: "Other" };
}

function googleToolCountForService(
  serviceId: string,
  connections: IntegrationConnectionSummary[]
): number {
  const preset = getGoogleServicePreset(serviceId);
  if (!preset) return 0;
  if (preset.connectionName === "google_ext") {
    const ext = connections.find(
      (c) => c.parentProvider === "google_workspace" && c.name === "google_ext"
    );
    if (!ext?.services?.includes(serviceId)) return 0;
    return ext.toolCount;
  }
  const conn = connections.find(
    (c) => c.parentProvider === "google_workspace" && c.name === preset.connectionName
  );
  return conn?.toolCount ?? 0;
}

function googleServiceConnected(
  serviceId: GoogleServiceId,
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): { connected: boolean; needsScopeReconnect: boolean; toolCount: number } {
  const preset = getGoogleServicePreset(serviceId);
  if (!preset || accounts.length === 0) {
    return { connected: false, needsScopeReconnect: false, toolCount: 0 };
  }
  const needsScopeReconnect = accounts.some(
    (a) => missingGoogleScopes(a.scopes, resolveGoogleServices([serviceId])).length > 0
  );
  const scopesOk = !needsScopeReconnect;
  const restOnly = GOOGLE_REST_SERVICE_IDS.includes(serviceId);
  if (!scopesOk) {
    return { connected: false, needsScopeReconnect: true, toolCount: 0 };
  }
  if (restOnly) {
    return { connected: true, needsScopeReconnect: false, toolCount: 0 };
  }
  if (preset.connectionName === "google_ext") {
    const ext = connections.find(
      (c) => c.parentProvider === "google_workspace" && c.name === "google_ext"
    );
    const attached = ext?.services?.includes(serviceId) ?? false;
    return {
      connected: attached,
      needsScopeReconnect: false,
      toolCount: attached ? ext?.toolCount ?? 0 : 0,
    };
  }
  const conn = connections.find(
    (c) => c.parentProvider === "google_workspace" && c.name === preset.connectionName
  );
  return {
    connected: Boolean(conn),
    needsScopeReconnect: false,
    toolCount: conn?.toolCount ?? 0,
  };
}

function microsoftServiceConnected(
  serviceId: MicrosoftServiceId,
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): { connected: boolean; needsScopeReconnect: boolean; toolCount: number } {
  const preset = getMicrosoftServicePreset(serviceId);
  if (!preset || accounts.length === 0) {
    return { connected: false, needsScopeReconnect: false, toolCount: 0 };
  }
  const needsScopeReconnect = accounts.some(
    (a) => missingMicrosoftScopes(a.scopes, resolveMicrosoftServices([serviceId])).length > 0
  );
  if (needsScopeReconnect) {
    return { connected: false, needsScopeReconnect: true, toolCount: 0 };
  }
  const restOnly = preset.backend === "microsoft_rest";
  if (restOnly) {
    return { connected: true, needsScopeReconnect: false, toolCount: 0 };
  }
  const graph = connections.find(
    (c) => c.parentProvider === "microsoft_365" && c.name === MICROSOFT_GRAPH_CONNECTION
  );
  const attached = graph?.services?.includes(serviceId) ?? false;
  return {
    connected: attached,
    needsScopeReconnect: false,
    toolCount: attached ? graph?.toolCount ?? 0 : 0,
  };
}

function azureServiceConnected(
  serviceId: AzureServiceId,
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): { connected: boolean; needsScopeReconnect: boolean; toolCount: number } {
  const preset = getAzureServicePreset(serviceId);
  if (!preset) {
    return { connected: false, needsScopeReconnect: false, toolCount: 0 };
  }
  const signedIn = accounts.length > 0;
  const needsScopeReconnect =
    signedIn &&
    accounts.some(
      (a) => missingAzureScopes(a.scopes, resolveAzureServices([serviceId]), "read_write").length > 0
    );
  if (needsScopeReconnect) {
    return { connected: false, needsScopeReconnect: true, toolCount: 0 };
  }
  const azureConn = connections.find(
    (c) => c.parentProvider === "azure" && c.name === AZURE_MCP_CONNECTION
  );
  const attached =
    Boolean(azureConn) &&
    (azureConn?.services?.includes(serviceId) ||
      azureConn?.services?.includes("all") ||
      serviceId === "resource");
  return {
    connected: signedIn && attached,
    needsScopeReconnect: false,
    toolCount: attached ? azureConn?.toolCount ?? 0 : 0,
  };
}

export function buildGoogleServiceCards(
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): IntegrationServiceCard[] {
  const signedIn = accounts.length > 0;
  return GOOGLE_WORKSPACE_SERVICES.map((preset) => {
    const { groupId, groupLabel } = groupMeta(GOOGLE_SERVICE_GROUPS, preset.id);
    const status = googleServiceConnected(preset.id, accounts, connections);
    return {
      category: "google",
      vendor: "google",
      serviceId: preset.id,
      label: preset.label,
      groupId,
      groupLabel,
      signedIn,
      connected: status.connected,
      toolCount: status.toolCount || googleToolCountForService(preset.id, connections),
      needsScopeReconnect: status.needsScopeReconnect,
      restOnly: GOOGLE_REST_SERVICE_IDS.includes(preset.id),
    };
  });
}

export function buildMicrosoftServiceCards(
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): IntegrationServiceCard[] {
  const signedIn = accounts.length > 0;
  return MICROSOFT_WORKSPACE_SERVICES.map((preset) => {
    const { groupId, groupLabel } = groupMeta(MICROSOFT_SERVICE_GROUPS, preset.id);
    const status = microsoftServiceConnected(preset.id, accounts, connections);
    return {
      category: "microsoft",
      vendor: "microsoft",
      serviceId: preset.id,
      label: preset.label,
      groupId,
      groupLabel,
      signedIn,
      connected: status.connected,
      toolCount: status.toolCount,
      needsScopeReconnect: status.needsScopeReconnect,
      restOnly: preset.backend === "microsoft_rest",
    };
  });
}

const AZURE_UI_GROUPS: Array<{ id: string; label: string; services: AzureServiceId[] }> = [
  { id: "platform", label: "Platform", services: ["all", "resource"] },
  {
    id: "compute",
    label: "Compute & containers",
    services: ["compute", "containers", "web", "functions", "appservice"],
  },
  { id: "data", label: "Data & storage", services: ["storage", "cosmos", "sql", "acr"] },
  { id: "ops", label: "Security & ops", services: ["keyvault", "network", "monitor", "terraform"] },
];

export function buildAzureServiceCards(
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): IntegrationServiceCard[] {
  const signedIn = accounts.length > 0;
  return AZURE_UI_GROUPS.flatMap((group) =>
    group.services
      .map((id) => getAzureServicePreset(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((preset) => {
        const status = azureServiceConnected(preset.id, accounts, connections);
        return {
          category: "microsoft",
          vendor: "azure",
          serviceId: preset.id,
          label: preset.label,
          groupId: group.id,
          groupLabel: group.label,
          signedIn,
          connected: status.connected,
          toolCount: status.toolCount,
          needsScopeReconnect: status.needsScopeReconnect,
          restOnly: preset.backend === "azure_rest",
        };
      })
  );
}

function awsServiceConnected(
  serviceId: AwsServiceId,
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): { connected: boolean; needsScopeReconnect: boolean; toolCount: number } {
  const signedIn = accounts.length > 0;
  if (!signedIn) {
    return { connected: false, needsScopeReconnect: false, toolCount: 0 };
  }
  const awsConn = connections.find(
    (c) => c.parentProvider === "aws" && c.name === AWS_MCP_CONNECTION
  );
  const attached = Boolean(
    awsConn &&
      (awsConn.services?.includes(serviceId) || awsConn.services?.includes("all"))
  );
  return {
    connected: signedIn && attached,
    needsScopeReconnect: false,
    toolCount: attached ? awsConn?.toolCount ?? 0 : 0,
  };
}

export function buildAwsServiceCards(
  accounts: IntegrationsOAuthAccount[],
  connections: IntegrationConnectionSummary[]
): IntegrationServiceCard[] {
  const signedIn = accounts.length > 0;
  return AWS_SERVICE_GROUPS.flatMap((group) =>
    group.services
      .map((id) => getAwsServicePreset(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((preset) => {
        const status = awsServiceConnected(preset.id, accounts, connections);
        return {
          category: "aws",
          vendor: "aws",
          serviceId: preset.id,
          label: preset.label,
          groupId: group.id,
          groupLabel: group.label,
          signedIn,
          connected: status.connected,
          toolCount: status.toolCount,
          needsScopeReconnect: status.needsScopeReconnect,
          restOnly: preset.backend === "aws_rest",
        };
      })
  );
}

export function buildWorkspaceServiceCards(input: {
  googleAccounts: IntegrationsOAuthAccount[];
  microsoftAccounts: IntegrationsOAuthAccount[];
  azureAccounts: IntegrationsOAuthAccount[];
  awsAccounts: IntegrationsOAuthAccount[];
  connections: IntegrationConnectionSummary[];
}): {
  google: IntegrationServiceCard[];
  microsoft: IntegrationServiceCard[];
  aws: IntegrationServiceCard[];
} {
  return {
    google: buildGoogleServiceCards(input.googleAccounts, input.connections),
    microsoft: [
      ...buildMicrosoftServiceCards(input.microsoftAccounts, input.connections),
      ...buildAzureServiceCards(input.azureAccounts, input.connections),
    ],
    aws: buildAwsServiceCards(input.awsAccounts, input.connections),
  };
}
