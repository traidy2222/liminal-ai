/**
 * Map dynamic mcp_<conn>_* tools to tool families for lazy-load summaries.
 */
import type { ToolRegistry } from "@liminal/core";

const CURATED_PARENT_FAMILIES = new Set([
  "google_workspace",
  "microsoft_365",
  "github",
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

export function registerConnectorToolFamilies(
  registry: ToolRegistry,
  connectionName: string,
  toolNames: string[],
  parentProvider?: string
): void {
  const curated = parentProvider ? curatedIntegrationFamilyId(parentProvider) : undefined;
  const fam = curated ?? connectorFamilyId(connectionName);
  const set = connectorFamilies.get(fam) ?? new Set<string>();
  for (const t of toolNames) set.add(t);
  connectorFamilies.set(fam, set);

  const existing = registry.cloneToolFamilyMap();
  for (const t of toolNames) {
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
