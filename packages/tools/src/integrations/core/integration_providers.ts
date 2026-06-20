/**
 * Curated integration provider catalog — single source for connect flow metadata.
 */
import type { IntegrationConnectMode } from "./integrations_snapshot.js";

export type IntegrationProviderId =
  | "google"
  | "microsoft"
  | "azure"
  | "github"
  | "xero"
  | "slack"
  | "linear"
  | "notion"
  | "youtube"
  | "ida";

export interface IntegrationProviderCatalogEntry {
  id: IntegrationProviderId;
  title: string;
  tagline: string;
  connectMode: IntegrationConnectMode;
  /** MCP parentProvider value when connectMode is oauth_mcp. */
  mcpParentProvider?: string;
  group: "workspace" | "collaboration" | "dev" | "finance";
}

export const INTEGRATION_PROVIDER_CATALOG: IntegrationProviderCatalogEntry[] = [
  {
    id: "google",
    title: "Google",
    tagline: "Gmail, Calendar, Drive & Docs",
    connectMode: "oauth_auto_attach",
    mcpParentProvider: "google_workspace",
    group: "workspace",
  },
  {
    id: "microsoft",
    title: "Microsoft 365",
    tagline: "Outlook, Teams & OneDrive",
    connectMode: "oauth_auto_attach",
    mcpParentProvider: "microsoft_365",
    group: "workspace",
  },
  {
    id: "azure",
    title: "Azure",
    tagline: "ARM resources & @azure/mcp",
    connectMode: "oauth_mcp",
    mcpParentProvider: "azure",
    group: "workspace",
  },
  {
    id: "slack",
    title: "Slack",
    tagline: "Channels, messages & team chat",
    connectMode: "oauth_auto_attach",
    group: "collaboration",
  },
  {
    id: "linear",
    title: "Linear",
    tagline: "Issues, teams & project tracking",
    connectMode: "oauth_auto_attach",
    group: "collaboration",
  },
  {
    id: "notion",
    title: "Notion",
    tagline: "Pages, databases & workspace docs",
    connectMode: "oauth_auto_attach",
    group: "collaboration",
  },
  {
    id: "youtube",
    title: "YouTube",
    tagline: "Channel, videos & uploads",
    connectMode: "oauth_auto_attach",
    group: "collaboration",
  },
  {
    id: "github",
    title: "GitHub",
    tagline: "Repos, issues & pull requests",
    connectMode: "oauth_mcp",
    mcpParentProvider: "github",
    group: "dev",
  },
  {
    id: "ida",
    title: "IDA Pro",
    tagline: "Reverse engineering via ida-pro-mcp",
    connectMode: "custom",
    mcpParentProvider: "ida",
    group: "dev",
  },
  {
    id: "xero",
    title: "Xero",
    tagline: "Invoices & accounting",
    connectMode: "oauth_auto_attach",
    group: "finance",
  },
];

export const INTEGRATION_PROVIDER_BY_ID = Object.fromEntries(
  INTEGRATION_PROVIDER_CATALOG.map((p) => [p.id, p])
) as Record<IntegrationProviderId, IntegrationProviderCatalogEntry>;
