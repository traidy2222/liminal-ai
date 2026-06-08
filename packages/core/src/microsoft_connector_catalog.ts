/**
 * Microsoft 365 connector presets — Graph delegated scopes + sidecar routing.
 */
export type MicrosoftServiceId =
  | "mail"
  | "calendar"
  | "onedrive"
  | "sharepoint"
  | "excel"
  | "onenote"
  | "teams"
  | "planner"
  | "todo"
  | "contacts"
  | "user"
  | "search";

export type MicrosoftConnectorBackend = "microsoft_sidecar" | "microsoft_rest";

export interface MicrosoftServicePreset {
  id: MicrosoftServiceId;
  label: string;
  backend: MicrosoftConnectorBackend;
  connectionName: string;
  scopes: string[];
  readOnlyScopes: string[];
}

/** All M365 services share one ms-365-mcp-server sidecar connection. */
export const MICROSOFT_GRAPH_CONNECTION = "microsoft";

export const MICROSOFT_WORKSPACE_SERVICES: MicrosoftServicePreset[] = [
  {
    id: "mail",
    label: "Outlook Mail",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Mail.Read", "Mail.ReadWrite", "Mail.Send"],
    readOnlyScopes: ["Mail.Read"],
  },
  {
    id: "calendar",
    label: "Outlook Calendar",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Calendars.ReadWrite", "OnlineMeetings.ReadWrite"],
    readOnlyScopes: ["Calendars.Read"],
  },
  {
    id: "onedrive",
    label: "OneDrive",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Files.ReadWrite.All"],
    readOnlyScopes: ["Files.Read.All"],
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Sites.ReadWrite.All"],
    readOnlyScopes: ["Sites.Read.All"],
  },
  {
    id: "excel",
    label: "Excel",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Files.ReadWrite.All"],
    readOnlyScopes: ["Files.Read.All"],
  },
  {
    id: "onenote",
    label: "OneNote",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Notes.ReadWrite.All"],
    readOnlyScopes: ["Notes.Read.All"],
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Chat.ReadWrite", "ChannelMessage.Send", "ChannelMessage.Read.All", "Team.ReadBasic.All"],
    readOnlyScopes: ["Chat.Read", "ChannelMessage.Read.All", "Team.ReadBasic.All"],
  },
  {
    id: "planner",
    label: "Planner",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Tasks.ReadWrite", "Group.Read.All"],
    readOnlyScopes: ["Tasks.Read", "Group.Read.All"],
  },
  {
    id: "todo",
    label: "Microsoft To Do",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Tasks.ReadWrite"],
    readOnlyScopes: ["Tasks.Read"],
  },
  {
    id: "contacts",
    label: "Contacts",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Contacts.ReadWrite", "People.Read"],
    readOnlyScopes: ["Contacts.Read", "People.Read"],
  },
  {
    id: "user",
    label: "User / Directory",
    backend: "microsoft_sidecar",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["User.Read", "User.ReadBasic.All"],
    readOnlyScopes: ["User.Read", "User.ReadBasic.All"],
  },
  {
    id: "search",
    label: "Microsoft Search",
    backend: "microsoft_rest",
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    scopes: ["Mail.Read", "Files.Read.All", "Sites.Read.All"],
    readOnlyScopes: ["Mail.Read", "Files.Read.All", "Sites.Read.All"],
  },
];

export const ALL_MICROSOFT_SERVICE_IDS: MicrosoftServiceId[] = MICROSOFT_WORKSPACE_SERVICES.map(
  (s) => s.id
);

export function getMicrosoftServicePreset(id: string): MicrosoftServicePreset | undefined {
  return MICROSOFT_WORKSPACE_SERVICES.find((s) => s.id === id);
}

export function resolveMicrosoftServices(serviceIds?: string[]): MicrosoftServicePreset[] {
  const ids =
    serviceIds && serviceIds.length > 0
      ? serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : ALL_MICROSOFT_SERVICE_IDS;
  const out: MicrosoftServicePreset[] = [];
  const seen = new Set<MicrosoftServiceId>();
  for (const id of ids) {
    const preset = getMicrosoftServicePreset(id);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

function collectMicrosoftPresetScopes(
  presets: MicrosoftServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  const scopeSet = new Set<string>();
  for (const p of presets) {
    const list = mode === "read_only" ? p.readOnlyScopes : p.scopes;
    for (const s of list) scopeSet.add(s);
  }
  return [...scopeSet];
}

export function apiScopesForMicrosoftServices(
  presets: MicrosoftServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  return collectMicrosoftPresetScopes(presets, mode);
}

/** Full OAuth consent scope list (API + offline_access + openid profile). */
export function scopesForMicrosoftServices(
  presets: MicrosoftServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  const scopeSet = new Set(collectMicrosoftPresetScopes(presets, mode));
  scopeSet.add("openid");
  scopeSet.add("profile");
  scopeSet.add("offline_access");
  scopeSet.add("User.Read");
  return [...scopeSet];
}

export function needsMicrosoftSidecar(presets: MicrosoftServicePreset[]): boolean {
  return presets.some((p) => p.backend === "microsoft_sidecar");
}

export function microsoftSidecarServiceIds(presets: MicrosoftServicePreset[]): MicrosoftServiceId[] {
  return presets.filter((p) => p.backend === "microsoft_sidecar").map((p) => p.id);
}

export const MICROSOFT_OAUTH_SCOPES_FULL = scopesForMicrosoftServices(
  MICROSOFT_WORKSPACE_SERVICES,
  "read_write"
);
