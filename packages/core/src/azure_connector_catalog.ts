/**
 * Azure connector presets — ARM delegated scopes + @azure/mcp namespace routing.
 */
export type AzureServiceId =
  | "resource"
  | "compute"
  | "storage"
  | "keyvault"
  | "network"
  | "web"
  | "containers"
  | "cosmos"
  | "sql"
  | "monitor"
  | "functions"
  | "acr"
  | "appservice"
  | "terraform"
  | "all";

export type AzureConnectorBackend = "azure_sidecar" | "azure_rest";

export interface AzureServicePreset {
  id: AzureServiceId;
  label: string;
  backend: AzureConnectorBackend;
  /** MCP namespace flag for --namespace mode (ignored when mode=all). */
  mcpNamespace?: string;
  scopes: string[];
  readOnlyScopes: string[];
}

/** Single @azure/mcp sidecar connection name. */
export const AZURE_MCP_CONNECTION = "azure";

export const ARM_DELEGATED_SCOPE = "https://management.azure.com/user_impersonation";

export const AZURE_WORKSPACE_SERVICES: AzureServicePreset[] = [
  {
    id: "all",
    label: "All Azure services (@azure/mcp)",
    backend: "azure_sidecar",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "resource",
    label: "Resource groups & subscriptions",
    backend: "azure_sidecar",
    mcpNamespace: "resource",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "compute",
    label: "Virtual machines",
    backend: "azure_sidecar",
    mcpNamespace: "compute",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "storage",
    label: "Storage accounts",
    backend: "azure_sidecar",
    mcpNamespace: "storage",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "keyvault",
    label: "Key Vault",
    backend: "azure_sidecar",
    mcpNamespace: "keyvault",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "web",
    label: "App Service / web apps",
    backend: "azure_sidecar",
    mcpNamespace: "web",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "containers",
    label: "Container Apps / AKS",
    backend: "azure_sidecar",
    mcpNamespace: "containers",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "cosmos",
    label: "Cosmos DB",
    backend: "azure_sidecar",
    mcpNamespace: "cosmos",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "sql",
    label: "Azure SQL",
    backend: "azure_sidecar",
    mcpNamespace: "sql",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "monitor",
    label: "Monitor & alerts",
    backend: "azure_sidecar",
    mcpNamespace: "monitor",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
  {
    id: "functions",
    label: "Azure Functions",
    backend: "azure_sidecar",
    mcpNamespace: "functions",
    scopes: [ARM_DELEGATED_SCOPE],
    readOnlyScopes: [ARM_DELEGATED_SCOPE],
  },
];

export const ALL_AZURE_SERVICE_IDS: AzureServiceId[] = AZURE_WORKSPACE_SERVICES.map((s) => s.id);

export function getAzureServicePreset(id: string): AzureServicePreset | undefined {
  return AZURE_WORKSPACE_SERVICES.find((s) => s.id === id);
}

export function resolveAzureServices(serviceIds?: string[]): AzureServicePreset[] {
  const ids =
    serviceIds && serviceIds.length > 0
      ? serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : ["all"];
  const out: AzureServicePreset[] = [];
  const seen = new Set<AzureServiceId>();
  for (const id of ids) {
    const preset = getAzureServicePreset(id);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

function collectAzurePresetScopes(
  presets: AzureServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  const scopeSet = new Set<string>();
  for (const p of presets) {
    const list = mode === "read_only" ? p.readOnlyScopes : p.scopes;
    for (const s of list) scopeSet.add(s);
  }
  return [...scopeSet];
}

export function scopesForAzureServices(
  presets: AzureServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  return collectAzurePresetScopes(presets, mode);
}

/** Full OAuth consent scope list for Azure Resource Manager. */
export function scopesForAzureConnect(mode: "read_write" | "read_only" = "read_write"): string[] {
  const scopeSet = new Set(collectAzurePresetScopes(AZURE_WORKSPACE_SERVICES, mode));
  scopeSet.add("openid");
  scopeSet.add("profile");
  scopeSet.add("offline_access");
  scopeSet.add("User.Read");
  return [...scopeSet];
}

export function needsAzureSidecar(presets: AzureServicePreset[]): boolean {
  return presets.some((p) => p.backend === "azure_sidecar");
}

export function azureSidecarNamespaces(presets: AzureServicePreset[]): string[] {
  if (presets.some((p) => p.id === "all")) return [];
  return presets
    .filter((p) => p.backend === "azure_sidecar" && p.mcpNamespace)
    .map((p) => p.mcpNamespace!);
}

export const AZURE_OAUTH_SCOPES_FULL = scopesForAzureConnect("read_write");
