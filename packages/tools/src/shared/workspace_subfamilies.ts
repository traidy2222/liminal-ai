/**
 * Google / Microsoft Workspace sub-families for lazy loading and MCP registration.
 */
import type { GoogleServiceId } from "@liminal/core";
import { WORKSPACE_TOOL_FAMILY_ALIASES } from "@liminal/core";

export const GOOGLE_WORKSPACE_SUBFAMILIES = [
  "google_mail",
  "google_calendar",
  "google_office",
  "google_drive",
  "google_marketing",
  "google_people",
] as const;

export type GoogleWorkspaceSubFamily = (typeof GOOGLE_WORKSPACE_SUBFAMILIES)[number];

export const MICROSOFT_WORKSPACE_SUBFAMILIES = [
  "microsoft_mail",
  "microsoft_calendar",
  "microsoft_files",
  "microsoft_collab",
  "microsoft_search",
] as const;

export type MicrosoftWorkspaceSubFamily = (typeof MICROSOFT_WORKSPACE_SUBFAMILIES)[number];

/** Umbrella family id → concrete sub-families for activate_tool_family. */
export const WORKSPACE_FAMILY_ALIASES = WORKSPACE_TOOL_FAMILY_ALIASES;

const GOOGLE_MCP_CONN: Record<string, GoogleWorkspaceSubFamily> = {
  google_gmail: "google_mail",
  google_calendar: "google_calendar",
  google_drive: "google_drive",
  google_chat: "google_people",
  google_people: "google_people",
  google_ext: "google_office",
  google_analytics: "google_marketing",
  google_search_console: "google_marketing",
};

const GOOGLE_SERVICE_SUB: Partial<Record<GoogleServiceId, GoogleWorkspaceSubFamily>> = {
  gmail: "google_mail",
  calendar: "google_calendar",
  drive: "google_drive",
  chat: "google_people",
  people: "google_people",
  contacts: "google_people",
  docs: "google_office",
  sheets: "google_office",
  slides: "google_office",
  forms: "google_office",
  tasks: "google_office",
  apps_script: "google_office",
  search: "google_office",
  analytics: "google_marketing",
  search_console: "google_marketing",
};

export function googleConnectionSubFamily(
  connectionName: string,
  services?: string[]
): GoogleWorkspaceSubFamily {
  const byConn = GOOGLE_MCP_CONN[connectionName];
  if (byConn) return byConn;
  if (services?.length) {
    for (const s of services) {
      const mapped = GOOGLE_SERVICE_SUB[s as GoogleServiceId];
      if (mapped) return mapped;
    }
  }
  return "google_mail";
}

export function googleRestToolSubFamily(toolName: string): GoogleWorkspaceSubFamily | undefined {
  if (
    toolName.startsWith("gmail_") ||
    toolName === "mail_search_inboxes" ||
    toolName.startsWith("mcp_google_gmail_")
  ) {
    return "google_mail";
  }
  if (toolName.startsWith("calendar_rest_") || toolName.startsWith("mcp_google_calendar_")) {
    return "google_calendar";
  }
  if (
    toolName.startsWith("docs_rest_") ||
    toolName.startsWith("sheets_rest_") ||
    toolName.startsWith("slides_rest_") ||
    toolName.startsWith("office_rest_") ||
    toolName.startsWith("mcp_google_ext_")
  ) {
    return "google_office";
  }
  if (toolName.startsWith("mcp_google_drive_")) return "google_drive";
  if (
    toolName.startsWith("analytics_rest_") ||
    toolName.startsWith("search_console_rest_")
  ) {
    return "google_marketing";
  }
  if (toolName.startsWith("mcp_google_chat_") || toolName.startsWith("mcp_google_people_")) {
    return "google_people";
  }
  return undefined;
}

export function microsoftRestToolSubFamily(toolName: string): MicrosoftWorkspaceSubFamily | undefined {
  if (
    toolName.startsWith("outlook_send") ||
    toolName.startsWith("outlook_create_draft") ||
    toolName === "email_style_infer"
  ) {
    return "microsoft_mail";
  }
  if (toolName.startsWith("outlook_calendar_rest_")) return "microsoft_calendar";
  if (
    toolName.startsWith("onedrive_rest_") ||
    toolName.startsWith("sharepoint_rest_") ||
    toolName.startsWith("excel_rest_") ||
    toolName.startsWith("office_rest_")
  ) {
    return "microsoft_files";
  }
  if (
    toolName.startsWith("teams_rest_") ||
    toolName.startsWith("planner_rest_") ||
    toolName.startsWith("todo_rest_") ||
    toolName.startsWith("onenote_rest_")
  ) {
    return "microsoft_collab";
  }
  if (toolName.startsWith("graph_search_rest_")) return "microsoft_search";
  return undefined;
}

/** Infer Microsoft MCP tool sub-family from remote tool name (mcp_microsoft_*). */
export function microsoftMcpToolSubFamily(toolName: string): MicrosoftWorkspaceSubFamily {
  const lower = toolName.toLowerCase();
  if (/mail|outlook|message|inbox/.test(lower)) return "microsoft_mail";
  if (/calendar|event|meeting|schedule/.test(lower)) return "microsoft_calendar";
  if (/onedrive|sharepoint|excel|file|drive|workbook/.test(lower)) return "microsoft_files";
  if (/teams|planner|todo|onenote|task/.test(lower)) return "microsoft_collab";
  if (/search/.test(lower)) return "microsoft_search";
  return "microsoft_mail";
}

export function inferGoogleSubFamiliesFromText(text: string): GoogleWorkspaceSubFamily[] {
  const t = text.toLowerCase();
  const out = new Set<GoogleWorkspaceSubFamily>();
  if (/gmail|email|inbox|mail\b/.test(t)) out.add("google_mail");
  if (/calendar|meeting|schedule|freebusy/.test(t)) out.add("google_calendar");
  if (/sheet|spreadsheet|gdoc|docs|slides|forms|office/.test(t)) out.add("google_office");
  if (/\bdrive\b|folder|file upload/.test(t)) out.add("google_drive");
  if (/analytics|ga4|search console|webmasters|seo\b/.test(t)) out.add("google_marketing");
  if (/people|contacts|chat\b/.test(t)) out.add("google_people");
  if (out.size === 0 && /google|workspace/.test(t)) out.add("google_mail");
  return [...out];
}

export function inferMicrosoftSubFamiliesFromText(text: string): MicrosoftWorkspaceSubFamily[] {
  const t = text.toLowerCase();
  const out = new Set<MicrosoftWorkspaceSubFamily>();
  if (/outlook|mail\b|email/.test(t)) out.add("microsoft_mail");
  if (/calendar|meeting|schedule/.test(t)) out.add("microsoft_calendar");
  if (/onedrive|sharepoint|excel|file/.test(t)) out.add("microsoft_files");
  if (/teams|planner|todo|onenote/.test(t)) out.add("microsoft_collab");
  if (/graph search|search across/.test(t)) out.add("microsoft_search");
  if (out.size === 0 && /microsoft|m365|office 365/.test(t)) out.add("microsoft_mail");
  return [...out];
}
