/**
 * Azure ARM OAuth scope helpers.
 */
import {
  ARM_DELEGATED_SCOPE,
  type AzureServicePreset,
  scopesForAzureServices,
} from "./azure_connector_catalog.js";

export function normalizeAzureScopes(scopes: string[]): string[] {
  return [...new Set(scopes.map((s) => s.trim()).filter(Boolean))];
}

export function missingAzureScopes(
  granted: string[],
  presets: AzureServicePreset[],
  mode: "read_write" | "read_only" = "read_write"
): string[] {
  const needed = scopesForAzureServices(presets, mode);
  const grantedNorm = new Set(granted.map((s) => s.toLowerCase()));
  return needed.filter((s) => !grantedNorm.has(s.toLowerCase()) && !granted.includes(s));
}

export function formatAzureScopeDiagnostics(
  granted: string[],
  presets: AzureServicePreset[],
  mode: "read_write" | "read_only" = "read_write"
): string {
  const missing = missingAzureScopes(granted, presets, mode);
  if (missing.length === 0) return "Azure ARM scopes OK.";
  return (
    `Missing Azure ARM scopes: ${missing.join(", ")}. ` +
    `Granted ${granted.length} scope(s); need ${ARM_DELEGATED_SCOPE}. Reconnect with connect_provider({ provider: "azure", start_oauth: true }).`
  );
}

export function missingDefaultAzureScopes(granted: string[]): string[] {
  const norm = new Set(granted.map((s) => s.toLowerCase()));
  return norm.has(ARM_DELEGATED_SCOPE.toLowerCase()) || granted.includes(ARM_DELEGATED_SCOPE)
    ? []
    : [ARM_DELEGATED_SCOPE];
}
