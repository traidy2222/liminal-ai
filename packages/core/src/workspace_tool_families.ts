/** Umbrella integration families → concrete lazy-load sub-families. */
export const WORKSPACE_TOOL_FAMILY_ALIASES: Record<string, readonly string[]> = {
  google_workspace: [
    "google_mail",
    "google_calendar",
    "google_office",
    "google_drive",
    "google_marketing",
    "google_people",
  ],
  microsoft_365: [
    "microsoft_mail",
    "microsoft_calendar",
    "microsoft_files",
    "microsoft_collab",
    "microsoft_search",
  ],
};

export function expandWorkspaceToolFamilies(familyIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of familyIds) {
    const f = raw.trim().toLowerCase();
    if (!f) continue;
    const alias = WORKSPACE_TOOL_FAMILY_ALIASES[f];
    if (alias) {
      for (const sub of alias) out.add(sub);
    } else {
      out.add(f);
    }
  }
  return [...out];
}

/** True when any registered tool maps to the family (umbrella aliases expand). */
export function registryHasToolFamily(
  family: string,
  toolNames: readonly string[],
  familyForTool: (tool: string) => string | undefined
): boolean {
  const want = new Set(expandWorkspaceToolFamilies([family]));
  return toolNames.some((t) => {
    const fam = familyForTool(t)?.toLowerCase();
    return fam != null && want.has(fam);
  });
}
