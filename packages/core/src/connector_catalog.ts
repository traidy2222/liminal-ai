/**
 * Connector presets — Google Workspace hybrid MCP routing (official + sidecar).
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

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
  | "search";

export type ConnectorBackend = "google_official_mcp" | "google_sidecar";

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
const SIDECAR_SERVICES: GoogleServiceId[] = [
  "docs",
  "sheets",
  "slides",
  "forms",
  "tasks",
  "contacts",
  "apps_script",
  "search",
];

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
    ],
  },
  {
    id: "gmail",
    label: "Gmail",
    backend: "google_official_mcp",
    mcpUrl: OFFICIAL_BASE.gmail,
    connectionName: "google_gmail",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
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
    ],
  },
  {
    id: "docs",
    label: "Google Docs",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: [
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
      "https://www.googleapis.com/auth/forms.body",
      "https://www.googleapis.com/auth/forms.responses.readonly",
    ],
  },
  {
    id: "tasks",
    label: "Google Tasks",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: ["https://www.googleapis.com/auth/tasks"],
  },
  {
    id: "contacts",
    label: "Google Contacts (sidecar)",
    backend: "google_sidecar",
    connectionName: "google_ext",
    scopes: ["https://www.googleapis.com/auth/contacts.readonly"],
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
];

export const ALL_GOOGLE_SERVICE_IDS: GoogleServiceId[] = GOOGLE_WORKSPACE_SERVICES.map((s) => s.id);

export function getGoogleServicePreset(id: string): GoogleServicePreset | undefined {
  return GOOGLE_WORKSPACE_SERVICES.find((s) => s.id === id);
}

export function resolveGoogleServices(serviceIds?: string[]): GoogleServicePreset[] {
  const ids =
    serviceIds && serviceIds.length > 0
      ? serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : ALL_GOOGLE_SERVICE_IDS;
  const out: GoogleServicePreset[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const preset = getGoogleServicePreset(id);
    if (!preset) continue;
    const key = preset.backend === "google_sidecar" ? "google_ext" : preset.connectionName;
    if (seen.has(key) && preset.backend === "google_sidecar") continue;
    if (preset.backend !== "google_sidecar") seen.add(preset.connectionName);
    else seen.add("google_ext");
    out.push(preset);
  }
  return out;
}

export function scopesForGoogleServices(
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
  scopeSet.add("openid");
  scopeSet.add("email");
  scopeSet.add("profile");
  return [...scopeSet];
}

export function needsGoogleSidecar(presets: GoogleServicePreset[]): boolean {
  return presets.some((p) => p.backend === "google_sidecar");
}

export function sidecarServiceIds(presets: GoogleServicePreset[]): GoogleServiceId[] {
  return presets.filter((p) => SIDECAR_SERVICES.includes(p.id)).map((p) => p.id);
}

export const GOOGLE_OAUTH_SCOPES_FULL = scopesForGoogleServices(GOOGLE_WORKSPACE_SERVICES, "read_write");

/**
 * How Gmail is reached:
 * - `rest`  — classic gmail.googleapis.com REST tools (`gmail_api_*`). Works with a
 *             normal OAuth token; needs NO Workspace MCP preview enrollment. Default.
 * - `mcp`   — only the preview `mcp_google_gmail_*` tools (requires preview enrollment
 *             AND the `gmailmcp.googleapis.com` *MCP* API enabled in Cloud Console).
 * - `auto`  — attach the preview MCP and keep REST tools available as a fallback.
 *
 * Gmail's official MCP endpoint (`gmailmcp.googleapis.com`) is an invite-only preview;
 * for most projects it returns 403 "The caller does not have permission", so `rest`
 * is the safe default and only preview-enrolled users should switch to `auto`/`mcp`.
 */
export type GoogleGmailTransport = "auto" | "rest" | "mcp";

export function resolveGoogleGmailTransport(): GoogleGmailTransport {
  const raw = effectiveHarnessEnvRaw("AGENT_GOOGLE_GMAIL_TRANSPORT")?.trim().toLowerCase();
  if (raw === "mcp" || raw === "auto") return raw;
  return "rest";
}

/** True when the preview Gmail MCP must NOT be attached (transport=rest). */
export function gmailMcpSuppressed(): boolean {
  return resolveGoogleGmailTransport() === "rest";
}

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
