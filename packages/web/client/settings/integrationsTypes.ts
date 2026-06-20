export interface OAuthAccount {
  accountId: string;
  email?: string;
  scopes: string[];
  expiresAt: number;
  missingScopes?: string[];
}

export interface ConnectionSummary {
  kind: "mcp" | "openapi";
  name: string;
  toolCount: number;
  sampleTools: string[];
  authKind: string;
  attachedAt: number;
  parentProvider?: string;
  serverUrl?: string;
  specUrl?: string;
  baseUrl?: string;
  readOnly?: boolean;
  services?: string[];
}

export interface WorkspaceServiceGroupDto {
  id: string;
  label: string;
  services: string[];
}

export interface WorkspaceConnectPresetDto {
  id: string;
  label: string;
  services: string[];
}

export interface IntegrationServiceCardDto {
  category: "google" | "microsoft";
  vendor: "google" | "microsoft" | "azure";
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

export interface IntegrationsData {
  google: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
    defaultServices: string[];
    serviceGroups: WorkspaceServiceGroupDto[];
    connectPresets: WorkspaceConnectPresetDto[];
  };
  microsoft?: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
    defaultServices: string[];
    serviceGroups: WorkspaceServiceGroupDto[];
    connectPresets: WorkspaceConnectPresetDto[];
  };
  azure?: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  github?: {
    accounts: Array<OAuthAccount & { login?: string }>;
  };
  ida?: {
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    enabled: boolean;
    guiReachable: boolean;
    mcpUrlOverride?: string;
  };
  xero?: {
    accounts: Array<
      OAuthAccount & {
        tenantId?: string;
        tenantName?: string;
        missingScopes?: string[];
        missingCoreScopes?: string[];
        missingFullScopes?: string[];
        missingExtendedScopes?: string[];
      }
    >;
  };
  slack?: {
    accounts: Array<OAuthAccount & { teamId?: string; teamName?: string }>;
  };
  linear?: {
    accounts: Array<OAuthAccount & { organizationName?: string }>;
  };
  notion?: {
    accounts: Array<OAuthAccount & { workspaceId?: string; workspaceName?: string }>;
  };
  youtube?: {
    accounts: Array<
      OAuthAccount & { channelId?: string; channelTitle?: string; customUrl?: string }
    >;
  };
  connections: ConnectionSummary[];
  serviceCards?: {
    google: IntegrationServiceCardDto[];
    microsoft: IntegrationServiceCardDto[];
  };
  providerStatus?: Record<
    string,
    {
      signedIn: boolean;
      toolsAttached: boolean;
      toolCount: number;
      ready: boolean;
      connectMode: "oauth_mcp" | "oauth_auto_attach" | "custom";
    }
  >;
}

export type IntegrationExpandedId =
  | `google:${string}`
  | `microsoft:${string}`
  | `azure:${string}`
  | "google-accounts"
  | "microsoft-accounts"
  | "xero"
  | "slack"
  | "linear"
  | "notion"
  | "youtube"
  | "github"
  | "ida"
  | "advanced"
  | null;

export type AuthKind = "none" | "bearer" | "header" | "basic";

export type ReadWriteMode = "read_write" | "read_only";
