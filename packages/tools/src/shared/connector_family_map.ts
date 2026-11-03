/**
 * Map dynamic mcp_<conn>_* tools to tool families for lazy-load summaries.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  googleConnectionSubFamily,
  googleRestToolSubFamily,
  microsoftMcpToolSubFamily,
  microsoftRestToolSubFamily,
} from "./workspace_subfamilies.js";

const CURATED_PARENT_FAMILIES = new Set([
  "google_workspace",
  "google_mail",
  "google_calendar",
  "google_office",
  "google_drive",
  "google_marketing",
  "google_people",
  "microsoft_365",
  "microsoft_mail",
  "microsoft_calendar",
  "microsoft_files",
  "microsoft_collab",
  "microsoft_search",
  "azure",
  "aws",
  "github",
  "ida",
  "xero",
  "slack",
  "linear",
  "notion",
]);

const connectorFamilies = new Map<string, Set<string>>();

export function connectorFamilyId(connectionName: string): string {
  return `connector:${connectionName}`;
}

export function curatedIntegrationFamilyId(parentProvider: string): string | undefined {
  const id = parentProvider.trim();
  return CURATED_PARENT_FAMILIES.has(id) ? id : undefined;
}

function resolveConnectorToolFamily(
  toolName: string,
  connectionName: string,
  parentProvider?: string,
  services?: string[]
): string {
  if (connectionName === "rea") {
    const name = toolName.replace(/^mcp_rea_/, "");
    const group = /^(binary_session|open_binary|close_binary)$/.test(name) ? "session"
      : /adb|android|apktool|jeb/.test(name) ? "android"
      : /evidence|unknown|reconstruction|compare_bundles|build_call_path/.test(name) ? "evidence"
      : /javascript|source_to_bundle|web_module|web_source/.test(name) ? "javascript"
      : /browser|web|electron|process_capture|process_scenario|native_ui/.test(name) ? "runtime"
      : /artifact|macho|plist|firmware|managed|pe_resources|architectures|signature|swift|keyed|interface_builder|asset_catalog|evm|binary_layout|recorded_crash/.test(name) ? "artifacts" : "native";
    return `connector:rea:${group}`;
  }
  if (parentProvider === "google_workspace") {
    return (
      googleRestToolSubFamily(toolName) ??
      googleConnectionSubFamily(connectionName, services)
    );
  }
  if (parentProvider === "microsoft_365") {
    return (
      microsoftRestToolSubFamily(toolName) ??
      (toolName.startsWith("mcp_microsoft_")
        ? microsoftMcpToolSubFamily(toolName)
        : "microsoft_mail")
    );
  }
  const curated = parentProvider ? curatedIntegrationFamilyId(parentProvider) : undefined;
  return curated ?? connectorFamilyId(connectionName);
}

export function registerConnectorToolFamilies(
  registry: ToolRegistry,
  connectionName: string,
  toolNames: string[],
  parentProvider?: string,
  opts?: { services?: string[] }
): void {
  const existing = registry.cloneToolFamilyMap();
  for (const t of toolNames) {
    const fam = resolveConnectorToolFamily(t, connectionName, parentProvider, opts?.services);
    const set = connectorFamilies.get(fam) ?? new Set<string>();
    set.add(t);
    connectorFamilies.set(fam, set);
    existing.set(t, fam);
  }
  registry.setToolFamilyLookup(existing);
}

export function buildConnectorFamilyEntries(): Array<{ family: string; tools: string[] }> {
  return [...connectorFamilies.entries()].map(([family, tools]) => ({
    family,
    tools: [...tools],
  }));
}

export function clearConnectorFamilyCache(): void {
  connectorFamilies.clear();
}
