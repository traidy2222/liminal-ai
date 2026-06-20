/**
 * Connector presets — Google Workspace hybrid MCP routing (official + sidecar).
 */
export type GoogleServiceId =
  | "drive"
  | "gmail"
  | "calendar"
  | "chat"
  | "people"
  | "docs"
  | "sheets"
  | "slides"
  | "forms"
  | "tasks"
  | "contacts"
  | "apps_script"
  | "search"
  | "analytics"
  | "search_console";

export type ConnectorBackend = "google_official_mcp" | "google_sidecar" | "google_rest";

export interface GoogleServicePreset {
  id: GoogleServiceId;
  label: string;
  backend: ConnectorBackend;
  /** Official MCP endpoint (when backend is google_official_mcp). */
  mcpUrl?: string;
  connectionName: string;
  scopes: string[];
}

const OFFICIAL_BASE: Record<string, string> = {
  drive: "https://drivemcp.googleapis.com/mcp/v1",
  gmail: "https://gmailmcp.googleapis.com/mcp/v1",
  calendar: "https://calendarmcp.googleapis.com/mcp/v1",
  chat: "https://chatmcp.googleapis.com/mcp/v1",
  people: "https://people.googleapis.com/mcp/v1",
};

/**
 * Separate from classic APIs (gmail.googleapis.com, drive.googleapis.com).
 * Liminal's official MCP tools call *mcp* endpoints — each needs its own enable in Cloud Console.
 */
export const GOOGLE_OFFICIAL_MCP_API_IDS: Partial<Record<GoogleServiceId, string>> = {
  drive: "drivemcp.googleapis.com",
  gmail: "gmailmcp.googleapis.com",
  calendar: "calendarmcp.googleapis.com",
  chat: "chatmcp.googleapis.com",
  /** People MCP uses people.googleapis.com/mcp/v1 (same host as classic People API). */
  people: "people.googleapis.com",
};

export function googleCloudMcpApiLibraryUrl(serviceId: GoogleServiceId, projectId?: string): string | null {
  const apiId = GOOGLE_OFFICIAL_MCP_API_IDS[serviceId];
  if (!apiId) return null;
  const q = projectId?.trim() ? `?project=${encodeURIComponent(projectId.trim())}` : "";
  return `https://console.cloud.google.com/apis/library/${apiId}${q}`;
}

/** Numeric project id from OAuth client id (`123456789-xxx.apps.googleusercontent.com`). */
export function googleProjectIdFromClientId(clientId?: string): string | undefined {
  const id = clientId?.trim() || process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!id) return undefined;
  const m = /^(\d+)-/.exec(id);
  return m?.[1];
}

/** Sidecar-backed services share one MCP connection (google_ext). */
export const GOOGLE_SIDECAR_SERVICE_IDS: GoogleServiceId[] = [
  "docs",
  "sheets",
  "slides",
  "forms",
  "tasks",
  "contacts",
  "apps_script",
  "search",
];

/** Lets Docs/Sheets/Slides tools discover files opened outside the app. */
const WORKSPACE_FILE_READ = "https://www.googleapis.com/auth/drive.readonly";

export const GOOGLE_WORKSPACE_SERVICES: GoogleServicePreset[] = [
  {
    id: "drive",
    label: "Google Drive",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.drive,
    connectionName: "google_drive",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ],
  },
  {
    id: "gmail",
    label: "Gmail",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.gmail,
    connectionName: "google_gmail",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  },
  {
    id: "calendar",
    label: "Google Calendar",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.calendar,
    connectionName: "google_calendar",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar",
    ],
  },
  {
    id: "chat",
    label: "Google Chat",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.chat,
    connectionName: "google_chat",
    scopes: [
      "https://www.googleapis.com/auth/chat.spaces.readonly",
      "https://www.googleapis.com/auth/chat.memberships.readonly",
      "https://www.googleapis.com/auth/chat.messages.readonly",
      "https://www.googleapis.com/auth/chat.messages.create",
      "https://www.googleapis.com/auth/chat.users.readstate.readonly",
    ],
  },
  {
    id: "people",
    label: "Google People / Contacts",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.people,
    connectionName: "google_people",
    scopes: [
      "https://www.googleapis.com/auth/directory.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  },
  {
    id: "docs",
    label: "Google Docs",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      WORKSPACE_FILE_READ,
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
  },
  {
    id: "sheets",
    label: "Google Sheets",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      WORKSPACE_FILE_READ,
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  },
  {
    id: "slides",
    label: "Google Slides",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      WORKSPACE_FILE_READ,
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/presentations.readonly",
    ],
  },
  {
    id: "forms",
    label: "Google Forms",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      WORKSPACE_FILE_READ,
      "https://www.googleapis.com/auth/forms.body",
      "https://www.googleapis.com/auth/forms.responses.readonly",
    ],
  },
  {
    id: "tasks",
    label: "Google Tasks",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/tasks.readonly",
    ],
  },
  {
    id: "contacts",
    label: "Google Contacts (sidecar)",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts",
    ],
  },
  {
    id: "apps_script",
    label: "Google Apps Script",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.scriptapp",
    ],
  },
  {
    id: "search",
    label: "Google Custom Search",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: ["https://www.googleapis.com/auth/cse"],
  },
  {
    id: "analytics",
    label: "Google Analytics (GA4)",
    backend: "google_rest",
    connectionName: "google_analytics",
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/analytics.edit",
    ],
  },
  {
    id: "search_console",
    label: "Google Search Console",
    backend: "google_rest",
    connectionName: "google_search_console",
    scopes: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/webmasters",
    ],
  },
];

/** REST-only Google services (no MCP attach — tools register via env gates). */
export const GOOGLE_REST_SERVICE_IDS: GoogleServiceId[] = ["analytics", "search_console"];

export const ALL_GOOGLE_SERVICE_IDS: GoogleServiceId[] = GOOGLE_WORKSPACE_SERVICES.map((s) => s.id);

/** Default connect/OAuth surface when services[] is omitted — daily workflow only. */
export const DEFAULT_GOOGLE_SERVICE_IDS: GoogleServiceId[] = ["gmail", "calendar"];

export interface WorkspaceServiceGroup {
  id: string;
  label: string;
  services: GoogleServiceId[];
}

export const GOOGLE_SERVICE_GROUPS: WorkspaceServiceGroup[] = [
  { id: "core", label: "Mail & calendar", services: ["gmail", "calendar"] },
  {
    id: "productivity",
    label: "Files & docs",
    services: ["drive", "docs", "sheets", "slides", "forms", "tasks"],
  },
  { id: "people", label: "People & chat", services: ["people", "chat", "contacts"] },
  { id: "marketing", label: "Marketing & SEO", services: ["analytics", "search_console"] },
  { id: "advanced", label: "Advanced", services: ["apps_script", "search"] },
];

export const GOOGLE_CONNECT_PRESETS: Array<{
  id: string;
  label: string;
  services: GoogleServiceId[];
}> = [
  { id: "daily", label: "Mail & calendar", services: ["gmail", "calendar"] },
  {
    id: "productivity",
    label: "Mail, calendar & docs",
    services: ["gmail", "calendar", "drive", "docs", "sheets", "slides", "forms", "tasks"],
  },
  { id: "all", label: "Everything", services: ALL_GOOGLE_SERVICE_IDS },
];

export function getGoogleServicePreset(id: string): GoogleServicePreset | undefined {
  return GOOGLE_WORKSPACE_SERVICES.find((s) => s.id === id);
}

export function resolveGoogleServices(serviceIds?: string[]): GoogleServicePreset[] {
  const ids =
    serviceIds && serviceIds.length > 0
      ? serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : DEFAULT_GOOGLE_SERVICE_IDS;
  const out: GoogleServicePreset[] = [];
  const seenOfficial = new Set<string>();
  for (const id of ids) {
    const preset = getGoogleServicePreset(id);
    if (!preset) continue;
    if (preset.backend === "google_official_mcp") {
      if (seenOfficial.has(preset.connectionName)) continue;
      seenOfficial.add(preset.connectionName);
    }
    out.push(preset);
  }
  return out;
}

function collectGooglePresetScopes(
  presets: GoogleServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  const scopeSet = new Set<string>();
  for (const p of presets) {
    if (mode === "read_only") {
      const readonly = p.scopes.filter((s) => s.includes(".readonly") || s.endsWith("/auth/drive.readonly"));
      if (readonly.length > 0) {
        for (const s of readonly) scopeSet.add(s);
      } else {
        scopeSet.add(p.scopes[0]!);
      }
    } else {
      for (const s of p.scopes) scopeSet.add(s);
    }
  }
  return [...scopeSet];
}

/** Workspace API scopes for the selected services (no OIDC identity scopes). */
export function apiScopesForGoogleServices(
  presets: GoogleServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  return collectGooglePresetScopes(presets, mode);
}

/** Full OAuth consent scope list (API + openid/email/profile for account identity). */
export function scopesForGoogleServices(
  presets: GoogleServicePreset[],
  mode: "read_write" | "read_only"
): string[] {
  const scopeSet = new Set(collectGooglePresetScopes(presets, mode));
  scopeSet.add("openid");
  scopeSet.add("email");
  scopeSet.add("profile");
  return [...scopeSet];
}

export function needsGoogleSidecar(presets: GoogleServicePreset[]): boolean {
  return presets.some((p) => p.backend === "google_sidecar");
}

export function needsGoogleRest(presets: GoogleServicePreset[]): boolean {
  return presets.some((p) => p.backend === "google_rest");
}

export function sidecarServiceIds(presets: GoogleServicePreset[]): GoogleServiceId[] {
  return presets.filter((p) => GOOGLE_SIDECAR_SERVICE_IDS.includes(p.id)).map((p) => p.id);
}

/** Internal service id → `workspace-mcp --tools` flag (CLI names differ for some services). */
const WORKSPACE_MCP_TOOL_CLI_NAMES: Partial<Record<GoogleServiceId, string>> = {
  apps_script: "appscript",
};

/** `workspace-mcp --tools` names for selected sidecar-backed services. */
export function workspaceMcpToolNamesForServices(serviceIds: GoogleServiceId[]): string[] {
  return serviceIds
    .filter((id) => GOOGLE_SIDECAR_SERVICE_IDS.includes(id))
    .map((id) => WORKSPACE_MCP_TOOL_CLI_NAMES[id] ?? id);
}

export const GOOGLE_OAUTH_SCOPES_FULL = scopesForGoogleServices(GOOGLE_WORKSPACE_SERVICES, "read_write");

/** Identify a persisted/curated connection as the official Gmail MCP. */
export function isGmailOfficialMcpConnection(opts: {
  name?: string;
  providerId?: string;
  parentProvider?: string;
  services?: string[];
}): boolean {
  if (opts.parentProvider && opts.parentProvider !== "google_workspace") return false;
  return (
    opts.name === "google_gmail" ||
    opts.providerId === "gmail" ||
    (opts.services ?? []).includes("gmail")
  );
}
