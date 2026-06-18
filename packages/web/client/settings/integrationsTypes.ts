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

export interface IntegrationsData {
  google: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  microsoft?: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  azure?: {
    accounts: OAuthAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  github?: {
    accounts: Array<OAuthAccount & { login?: string }>;
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
  connections: ConnectionSummary[];
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
  | "google"
  | "microsoft"
  | "azure"
  | "xero"
  | "slack"
  | "linear"
  | "notion"
  | "github"
  | "advanced"
  | null;

export type AuthKind = "none" | "bearer" | "header" | "basic";

export type ReadWriteMode = "read_write" | "read_only";
