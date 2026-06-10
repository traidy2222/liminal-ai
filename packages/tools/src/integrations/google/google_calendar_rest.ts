/**
 * Google Calendar REST supplements — classic calendar.googleapis.com for features
 * beyond or finer-grained than official mcp_google_calendar_* (freebusy batch,
 * quick add, calendar/ACL management, Meet links, recurring instances, iCal import).
 */
import { randomBytes } from "node:crypto";
import { effectiveHarnessEnvRaw, getGoogleAccessToken } from "@liminal/core";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export function calendarRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_CALENDAR_REST") !== "0";
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

async function calendarApiJson<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!calendarRestEnabled()) {
    return { ok: false, error: "Calendar REST tools are off (set AGENT_GOOGLE_CALENDAR_REST=1)." };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Connect via Settings → Integrations or `liminal connect google --attach`.",
    };
  }
  const url = path.startsWith("http") ? path : `${CALENDAR_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* use raw */
    }
    return { ok: false, error: `Calendar API HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Calendar API returned non-JSON body" };
  }
}

function jsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

function calendarIdArg(args: Record<string, unknown>): string {
  const id = String(args["calendar_id"] ?? "primary").trim();
  return id || "primary";
}

function sendUpdatesArg(args: Record<string, unknown>): "all" | "externalOnly" | "none" | undefined {
  const v = String(args["send_updates"] ?? "").trim();
  if (v === "all" || v === "externalOnly" || v === "none") return v;
  return undefined;
}

function meetConferenceData(): Record<string, unknown> {
  return {
    createRequest: {
      requestId: randomBytes(8).toString("hex"),
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  };
}

function objectSchema(description: string): PropertySchema {
  return { type: "object", description, additionalProperties: true } as PropertySchema;
}

function reminderOverridesArg(args: Record<string, unknown>): unknown[] | undefined {
  if (!Array.isArray(args["default_reminders"])) return undefined;
  return args["default_reminders"] as unknown[];
}

export function createGoogleCalendarRestTools(): ToolDefinition[] {
  const calendarRestGetCalendar = defineTool({
    name: "calendar_rest_get_calendar",
    description:
      "WHAT: Get calendar metadata (summary, description, location, timeZone).\n" +
      "WHEN: Before changing timezone or verifying primary/secondary calendar settings.\n" +
      "HOW: calendar_id=primary for the user's main calendar.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const calId = encodeURIComponent(calendarIdArg(args));
      const res = await calendarApiJson<unknown>(`/calendars/${calId}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestListCalendars = defineTool({
    name: "calendar_rest_list_calendars",
    description:
      "WHAT: List calendars on the user's calendar list (calendarList.list).\n" +
      "WHEN: User asks what calendars they have, which is primary, or before targeting an id.\n" +
      "Includes per-calendar accessRole, color, hidden, selected, defaultReminders.",
    parameters: {
      type: "object",
      properties: {
        show_hidden: { type: "boolean", description: "Include hidden calendars." },
        show_deleted: { type: "boolean", description: "Include deleted entries." },
        min_access_role: {
          type: "string",
          enum: ["freeBusyReader", "reader", "writer", "owner"],
          description: "Filter by minimum access role.",
        },
        max_results: { type: "number" },
        page_token: { type: "string" },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const q = qs({
        showHidden: args["show_hidden"] === true ? true : undefined,
        showDeleted: args["show_deleted"] === true ? true : undefined,
        minAccessRole: String(args["min_access_role"] ?? "").trim() || undefined,
        maxResults: typeof args["max_results"] === "number" ? args["max_results"] : undefined,
        pageToken: String(args["page_token"] ?? "").trim() || undefined,
      });
      const res = await calendarApiJson<unknown>(`/users/me/calendarList${q}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestListSettings = defineTool({
    name: "calendar_rest_list_settings",
    description:
      "WHAT: List the user's Calendar UI settings (timezone, weekStart, timeFormat, locale, …).\n" +
      "WHEN: User asks their account timezone — note: settings are **read-only** via API; change per-calendar timeZone with calendar_rest_set_timezone or calendar_rest_manage_calendar.\n" +
      "Common ids: timezone, weekStart, dateFieldOrder, timeFormat, locale, showDeclinedEvents.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (): Promise<ToolResult> => {
      const res = await calendarApiJson<unknown>("/users/me/settings");
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestGetSetting = defineTool({
    name: "calendar_rest_get_setting",
    description:
      "WHAT: Get one Calendar user setting by id (e.g. timezone → America/Los_Angeles).\n" +
      "Read-only. Account timezone is changed in Google Account settings, not this API.",
    parameters: {
      type: "object",
      properties: {
        setting_id: {
          type: "string",
          description: "Setting id, e.g. timezone, weekStart, timeFormat, locale.",
        },
      },
      required: ["setting_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["setting_id"] ?? "").trim();
      if (!id) return { ok: false, error: "setting_id is required" };
      const res = await calendarApiJson<unknown>(`/users/me/settings/${encodeURIComponent(id)}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestSetTimezone = defineTool({
    name: "calendar_rest_set_timezone",
    description:
      "WHAT: Set the IANA timeZone on a calendar (including primary).\n" +
      "WHEN: User wants events on a calendar shown in a specific timezone.\n" +
      "NOTE: Google Account default timezone (settings.timezone) is read-only via API — this updates the **calendar resource** timeZone (primary or secondary).",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
        time_zone: {
          type: "string",
          description: "IANA name, e.g. America/New_York, Europe/London, America/Los_Angeles.",
        },
      },
      required: ["time_zone"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const tz = String(args["time_zone"] ?? "").trim();
      if (!tz) return { ok: false, error: "time_zone is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const res = await calendarApiJson<unknown>(`/calendars/${calId}`, {
        method: "PATCH",
        body: JSON.stringify({ timeZone: tz }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestListColors = defineTool({
    name: "calendar_rest_list_colors",
    description:
      "WHAT: List available calendar and event color ids (Calendar colors.get).\n" +
      "WHEN: User wants to set calendarList colorId or event colorId.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 3600_000,
    handler: async (): Promise<ToolResult> => {
      const res = await calendarApiJson<unknown>("/colors");
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestPatchCalendarList = defineTool({
    name: "calendar_rest_patch_calendar_list",
    description:
      "WHAT: Update how a calendar appears in the user's list (color, hidden, default reminders, name override).\n" +
      "WHEN: Hide a calendar, change its color, or set default event reminders for that calendar.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar list entry id." },
        summary_override: { type: "string", description: "Custom display name." },
        color_id: { type: "string", description: "Color id from calendar_rest_list_colors." },
        background_color: { type: "string", description: "Hex #RRGGBB (overrides colorId)." },
        foreground_color: { type: "string", description: "Hex #RRGGBB for text." },
        hidden: { type: "boolean" },
        selected: { type: "boolean", description: "Show in calendar UI." },
        default_reminders: {
          type: "array",
          description: "e.g. [{ method: 'popup', minutes: 10 }]",
          items: objectSchema("Reminder override (method, minutes)."),
        },
      },
      required: ["calendar_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const calId = String(args["calendar_id"] ?? "").trim();
      if (!calId) return { ok: false, error: "calendar_id is required" };
      const body: Record<string, unknown> = {};
      const so = String(args["summary_override"] ?? "").trim();
      const colorId = String(args["color_id"] ?? "").trim();
      const bg = String(args["background_color"] ?? "").trim();
      const fg = String(args["foreground_color"] ?? "").trim();
      if (so) body.summaryOverride = so;
      if (colorId) body.colorId = colorId;
      if (bg) body.backgroundColor = bg;
      if (fg) body.foregroundColor = fg;
      if (typeof args["hidden"] === "boolean") body.hidden = args["hidden"];
      if (typeof args["selected"] === "boolean") body.selected = args["selected"];
      const reminders = reminderOverridesArg(args);
      if (reminders) body.defaultReminders = reminders;
      if (Object.keys(body).length === 0) {
        return { ok: false, error: "provide at least one field to patch" };
      }
      const res = await calendarApiJson<unknown>(`/users/me/calendarList/${encodeURIComponent(calId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestSubscribeCalendar = defineTool({
    name: "calendar_rest_subscribe_calendar",
    description:
      "WHAT: Add an existing calendar to the user's calendar list (calendarList.insert).\n" +
      "WHEN: User was shared a calendar or wants to follow a coworker's calendar by id.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id to subscribe to." },
        hidden: { type: "boolean" },
        selected: { type: "boolean" },
        color_id: { type: "string" },
      },
      required: ["calendar_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const calId = String(args["calendar_id"] ?? "").trim();
      if (!calId) return { ok: false, error: "calendar_id is required" };
      const body: Record<string, unknown> = { id: calId };
      if (typeof args["hidden"] === "boolean") body.hidden = args["hidden"];
      if (typeof args["selected"] === "boolean") body.selected = args["selected"];
      if (typeof args["color_id"] === "string" && args["color_id"].trim()) {
        body.colorId = args["color_id"].trim();
      }
      const res = await calendarApiJson<unknown>("/users/me/calendarList", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestUnsubscribeCalendar = defineTool({
    name: "calendar_rest_unsubscribe_calendar",
    description:
      "WHAT: Remove a calendar from the user's list (calendarList.delete) — does not delete the calendar for owners.\n" +
      "WHEN: User wants to unfollow/hide a shared calendar from their sidebar.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
      },
      required: ["calendar_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const calId = String(args["calendar_id"] ?? "").trim();
      if (!calId) return { ok: false, error: "calendar_id is required" };
      if (calId === "primary") {
        return { ok: false, error: "cannot unsubscribe from primary calendar" };
      }
      const res = await calendarApiJson<unknown>(`/users/me/calendarList/${encodeURIComponent(calId)}`, {
        method: "DELETE",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, output: `Unsubscribed from calendar list entry ${calId}` };
    },
  });

  const calendarRestClearCalendar = defineTool({
    name: "calendar_rest_clear_calendar",
    description:
      "WHAT: Delete all events from a secondary calendar (calendars.clear).\n" +
      "WHEN: User wants to wipe a project calendar — **cannot** clear primary.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
      },
      required: ["calendar_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const calId = String(args["calendar_id"] ?? "").trim();
      if (!calId) return { ok: false, error: "calendar_id is required" };
      if (calId === "primary") return { ok: false, error: "cannot clear primary calendar" };
      const res = await calendarApiJson<unknown>(`/calendars/${encodeURIComponent(calId)}/clear`, {
        method: "POST",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, output: `Cleared all events from calendar ${calId}` };
    },
  });

  const calendarRestListEvents = defineTool({
    name: "calendar_rest_list_events",
    description:
      "WHAT: List/search events via REST with full query options (events.list).\n" +
      "WHEN: MCP list_events is insufficient — need q search, orderBy, updatedMin, or showDeleted.\n" +
      "Set single_events=true (default) to expand recurrences.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        time_min: { type: "string", description: "RFC3339 lower bound (exclusive)." },
        time_max: { type: "string", description: "RFC3339 upper bound (exclusive)." },
        q: { type: "string", description: "Free text search terms." },
        single_events: { type: "boolean", description: "Expand recurring (default true)." },
        order_by: { type: "string", enum: ["startTime", "updated"] },
        max_results: { type: "number" },
        page_token: { type: "string" },
        show_deleted: { type: "boolean" },
        updated_min: { type: "string", description: "RFC3339 — events updated after this time." },
        time_zone: { type: "string", description: "IANA timezone for response." },
        event_types: {
          type: "array",
          items: { type: "string" },
          description: "Filter: default, focusTime, outOfOffice, workingLocation.",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 20_000,
    handler: async (args): Promise<ToolResult> => {
      const calId = encodeURIComponent(calendarIdArg(args));
      const singleEvents = args["single_events"] !== false;
      const q = qs({
        timeMin: String(args["time_min"] ?? "").trim() || undefined,
        timeMax: String(args["time_max"] ?? "").trim() || undefined,
        q: String(args["q"] ?? "").trim() || undefined,
        singleEvents: singleEvents ? true : undefined,
        orderBy: singleEvents && args["order_by"] === "startTime" ? "startTime" : args["order_by"] === "updated" ? "updated" : undefined,
        maxResults: typeof args["max_results"] === "number" ? args["max_results"] : 50,
        pageToken: String(args["page_token"] ?? "").trim() || undefined,
        showDeleted: args["show_deleted"] === true ? true : undefined,
        updatedMin: String(args["updated_min"] ?? "").trim() || undefined,
        timeZone: String(args["time_zone"] ?? "").trim() || undefined,
        eventTypes: Array.isArray(args["event_types"])
          ? (args["event_types"] as unknown[]).map(String).join(",")
          : undefined,
      });
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/events${q}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestGetEvent = defineTool({
    name: "calendar_rest_get_event",
    description:
      "WHAT: Get a single event by id (events.get) including attendees, recurrence, conferenceData.\n" +
      "WHEN: Need full event JSON before patch/replace/move.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        time_zone: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 20_000,
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      if (!eventId) return { ok: false, error: "event_id is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({ timeZone: String(args["time_zone"] ?? "").trim() || undefined });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}${q}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestReplaceEvent = defineTool({
    name: "calendar_rest_replace_event",
    description:
      "WHAT: Replace an event entirely (PUT events.update) — overwrites all fields.\n" +
      "WHEN: Full event replacement is simpler than patch; include complete Event resource.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        event: objectSchema("Complete Calendar API Event resource."),
        add_google_meet: { type: "boolean" },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
      },
      required: ["event_id", "event"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      if (!eventId) return { ok: false, error: "event_id is required" };
      const event = args["event"];
      if (!event || typeof event !== "object") return { ok: false, error: "event is required" };
      const body = { ...(event as Record<string, unknown>) };
      if (args["add_google_meet"] === true) body.conferenceData = meetConferenceData();
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({
        conferenceDataVersion: args["add_google_meet"] === true ? 1 : undefined,
        sendUpdates: sendUpdatesArg(args) ?? "none",
      });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}${q}`,
        { method: "PUT", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestRespondToEvent = defineTool({
    name: "calendar_rest_respond_to_event",
    description:
      "WHAT: RSVP to an event as the authenticated user (patch attendee responseStatus).\n" +
      "WHEN: Accept/decline/tentative on an invitation — alternative to MCP respond_to_event.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        response_status: {
          type: "string",
          enum: ["needsAction", "declined", "tentative", "accepted"],
        },
        comment: { type: "string", description: "Optional note to organizer." },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
      },
      required: ["event_id", "response_status"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      const status = String(args["response_status"] ?? "").trim();
      if (!eventId || !status) return { ok: false, error: "event_id and response_status are required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const getRes = await calendarApiJson<{ attendees?: Array<Record<string, unknown>> }>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}`
      );
      if (!getRes.ok) return { ok: false, error: getRes.error };
      const attendees = [...(getRes.data.attendees ?? [])];
      let patched = false;
      for (const a of attendees) {
        if (a.self === true) {
          a.responseStatus = status;
          const comment = String(args["comment"] ?? "").trim();
          if (comment) a.comment = comment;
          patched = true;
          break;
        }
      }
      if (!patched) {
        return {
          ok: false,
          error: "Could not find self attendee on event — user may not be invited.",
        };
      }
      const q = qs({ sendUpdates: sendUpdatesArg(args) ?? "all" });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}${q}`,
        { method: "PATCH", body: JSON.stringify({ attendees }) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestFreebusy = defineTool({
    name: "calendar_rest_freebusy",
    description:
      "WHAT: Query free/busy times across calendars (batch freeBusy API).\n" +
      "WHEN: Scheduling across people or rooms — finer control than mcp suggest_time; use before proposing slots.\n" +
      "HOW: time_min/time_max ISO8601; calendar_ids[] (default [primary]). Returns busy blocks per calendar.",
    parameters: {
      type: "object",
      properties: {
        time_min: { type: "string", description: "Range start (RFC3339), e.g. 2026-06-10T09:00:00-07:00" },
        time_max: { type: "string", description: "Range end (RFC3339)" },
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description: "Calendar IDs to query (emails or calendar id). Default: [primary].",
        },
        time_zone: { type: "string", description: "Optional IANA timezone for free/busy interpretation." },
      },
      required: ["time_min", "time_max"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const timeMin = String(args["time_min"] ?? "").trim();
      const timeMax = String(args["time_max"] ?? "").trim();
      if (!timeMin || !timeMax) return { ok: false, error: "time_min and time_max are required" };
      const ids = Array.isArray(args["calendar_ids"])
        ? (args["calendar_ids"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
        : ["primary"];
      const items = ids.map((id) => ({ id }));
      const body: Record<string, unknown> = { timeMin, timeMax, items };
      const tz = String(args["time_zone"] ?? "").trim();
      if (tz) body.timeZone = tz;
      const res = await calendarApiJson<unknown>("/freeBusy", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestListAcl = defineTool({
    name: "calendar_rest_list_acl",
    description:
      "WHAT: List sharing rules (ACL) on a calendar.\n" +
      "WHEN: User asks who can see/edit a calendar or before changing sharing.\n" +
      "Requires https://www.googleapis.com/auth/calendar scope on OAuth token.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const calId = encodeURIComponent(calendarIdArg(args));
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/acl`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestListInstances = defineTool({
    name: "calendar_rest_list_instances",
    description:
      "WHAT: Expand recurring events into instances in a time window.\n" +
      "WHEN: User asks about occurrences of a repeating meeting; MCP list_events may not expand RRULE.\n" +
      "HOW: event_id from mcp_google_calendar_get_event or list_events; time_min/time_max bound the window.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
        event_id: { type: "string", description: "Recurring master event id." },
        time_min: { type: "string", description: "Instances on or after (RFC3339)." },
        time_max: { type: "string", description: "Instances before (RFC3339)." },
        max_results: { type: "number", description: "Max instances (default 50)." },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      if (!eventId) return { ok: false, error: "event_id is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({
        timeMin: String(args["time_min"] ?? "").trim() || undefined,
        timeMax: String(args["time_max"] ?? "").trim() || undefined,
        maxResults: typeof args["max_results"] === "number" ? args["max_results"] : 50,
      });
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/events/${encodeURIComponent(eventId)}/instances${q}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestQuickAdd = defineTool({
    name: "calendar_rest_quick_add",
    description:
      "WHAT: Create an event from natural language (quickAdd API).\n" +
      "WHEN: User gives a fuzzy time phrase ('Lunch with Sam next Tuesday noon').\n" +
      "SAFETY: approval-gated.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
        text: { type: "string", description: "Natural language event description." },
        send_updates: {
          type: "string",
          enum: ["all", "externalOnly", "none"],
          description: "Guest notifications (default none).",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const text = String(args["text"] ?? "").trim();
      if (!text) return { ok: false, error: "text is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({ sendUpdates: sendUpdatesArg(args) ?? "none", text });
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/events/quickAdd${q}`, { method: "POST" });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestManageCalendar = defineTool({
    name: "calendar_rest_manage_calendar",
    description:
      "WHAT: Create, update, or delete a calendar resource (calendars insert/patch/delete).\n" +
      "WHEN: New team calendar, rename, description/location/timeZone on primary or secondary.\n" +
      "Primary: update allowed (incl. timeZone); delete blocked — use calendar_rest_unsubscribe_calendar to hide.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"] },
        calendar_id: { type: "string", description: "Required for update/delete (use primary for main calendar)." },
        summary: { type: "string", description: "Display name (create/update)." },
        description: { type: "string" },
        location: { type: "string", description: "Geographic location text." },
        time_zone: { type: "string", description: "IANA timezone (create/update)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const action = String(args["action"] ?? "").trim();
      if (action === "create") {
        const summary = String(args["summary"] ?? "").trim();
        if (!summary) return { ok: false, error: "summary is required for create" };
        const body: Record<string, unknown> = { summary };
        const desc = String(args["description"] ?? "").trim();
        const tz = String(args["time_zone"] ?? "").trim();
        if (desc) body.description = desc;
        if (tz) body.timeZone = tz;
        const res = await calendarApiJson<unknown>("/calendars", { method: "POST", body: JSON.stringify(body) });
        if (!res.ok) return { ok: false, error: res.error };
        return jsonResult(res.data);
      }
      const calId = String(args["calendar_id"] ?? "").trim();
      if (!calId) return { ok: false, error: "calendar_id is required for update/delete" };
      if (action === "delete" && calId === "primary") {
        return { ok: false, error: "cannot delete primary calendar" };
      }
      const enc = encodeURIComponent(calId);
      if (action === "delete") {
        const res = await calendarApiJson<unknown>(`/calendars/${enc}`, { method: "DELETE" });
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, output: `Deleted calendar ${calId}` };
      }
      if (action === "update") {
        const body: Record<string, unknown> = {};
        const summary = String(args["summary"] ?? "").trim();
        const desc = String(args["description"] ?? "").trim();
        const loc = String(args["location"] ?? "").trim();
        const tz = String(args["time_zone"] ?? "").trim();
        if (summary) body.summary = summary;
        if (desc) body.description = desc;
        if (loc) body.location = loc;
        if (tz) body.timeZone = tz;
        if (Object.keys(body).length === 0) {
          return { ok: false, error: "provide summary, description, location, and/or time_zone to update" };
        }
        const res = await calendarApiJson<unknown>(`/calendars/${enc}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: res.error };
        return jsonResult(res.data);
      }
      return { ok: false, error: `unknown action '${action}'` };
    },
  });

  const calendarRestInsertEvent = defineTool({
    name: "calendar_rest_insert_event",
    description:
      "WHAT: Create a calendar event with full Event JSON (attendees, reminders, recurrence, location).\n" +
      "WHEN: MCP create_event is too limited — need RRULE, multiple attendees, custom reminders, or Google Meet.\n" +
      "HOW: Pass `event` object per Calendar API; set add_google_meet=true for Meet link (conferenceDataVersion=1).",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Calendar id (default primary)." },
        event: objectSchema(
          "Calendar API Event resource (summary, start, end, attendees, recurrence, reminders, etc.)."
        ),
        add_google_meet: { type: "boolean", description: "Add Google Meet conference link." },
        send_updates: {
          type: "string",
          enum: ["all", "externalOnly", "none"],
          description: "Guest email notifications.",
        },
      },
      required: ["event"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const event = args["event"];
      if (!event || typeof event !== "object") return { ok: false, error: "event object is required" };
      const body = { ...(event as Record<string, unknown>) };
      if (args["add_google_meet"] === true) {
        body.conferenceData = meetConferenceData();
      }
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({
        conferenceDataVersion: args["add_google_meet"] === true ? 1 : undefined,
        sendUpdates: sendUpdatesArg(args) ?? "none",
      });
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/events${q}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestPatchEvent = defineTool({
    name: "calendar_rest_patch_event",
    description:
      "WHAT: Partially update an event (PATCH) with sendUpdates control.\n" +
      "WHEN: Reschedule, add attendees, or change details without replacing the whole event.\n" +
      "HOW: event_patch fields merge into existing event; set add_google_meet to attach Meet.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        event_patch: objectSchema("Fields to patch (Calendar API Event fragment)."),
        add_google_meet: { type: "boolean" },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
      },
      required: ["event_id", "event_patch"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      if (!eventId) return { ok: false, error: "event_id is required" };
      const patch = args["event_patch"];
      if (!patch || typeof patch !== "object") return { ok: false, error: "event_patch object is required" };
      const body = { ...(patch as Record<string, unknown>) };
      if (args["add_google_meet"] === true) body.conferenceData = meetConferenceData();
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({
        conferenceDataVersion: args["add_google_meet"] === true ? 1 : undefined,
        sendUpdates: sendUpdatesArg(args) ?? "none",
      });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}${q}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestDeleteEvent = defineTool({
    name: "calendar_rest_delete_event",
    description:
      "WHAT: Delete/cancel an event with explicit guest notification control.\n" +
      "WHEN: Cancel a meeting and choose whether attendees get email (send_updates).",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      if (!eventId) return { ok: false, error: "event_id is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({ sendUpdates: sendUpdatesArg(args) ?? "all" });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}${q}`,
        { method: "DELETE" }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, output: `Deleted event ${eventId} from ${calendarIdArg(args)}` };
    },
  });

  const calendarRestMoveEvent = defineTool({
    name: "calendar_rest_move_event",
    description:
      "WHAT: Move an event to another calendar (events.move).\n" +
      "WHEN: User wants an event on a different calendar without recreating it.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Source calendar id." },
        event_id: { type: "string" },
        destination_calendar_id: { type: "string", description: "Target calendar id." },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
      },
      required: ["event_id", "destination_calendar_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const eventId = String(args["event_id"] ?? "").trim();
      const dest = String(args["destination_calendar_id"] ?? "").trim();
      if (!eventId || !dest) return { ok: false, error: "event_id and destination_calendar_id are required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const q = qs({
        destination: dest,
        sendUpdates: sendUpdatesArg(args) ?? "none",
      });
      const res = await calendarApiJson<unknown>(
        `/calendars/${calId}/events/${encodeURIComponent(eventId)}/move${q}`,
        { method: "POST" }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestImportEvent = defineTool({
    name: "calendar_rest_import_event",
    description:
      "WHAT: Import an iCalendar-format event (events.import).\n" +
      "WHEN: User has .ics content or an imported invite to add as a private copy.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event: objectSchema("Event resource (often includes iCalUID from import)."),
        conference_data_version: { type: "number", description: "0 or 1 for conference data." },
      },
      required: ["event"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const event = args["event"];
      if (!event || typeof event !== "object") return { ok: false, error: "event is required" };
      const calId = encodeURIComponent(calendarIdArg(args));
      const v = typeof args["conference_data_version"] === "number" ? args["conference_data_version"] : undefined;
      const q = qs({ conferenceDataVersion: v });
      const res = await calendarApiJson<unknown>(`/calendars/${calId}/events/import${q}`, {
        method: "POST",
        body: JSON.stringify(event),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const calendarRestSetAcl = defineTool({
    name: "calendar_rest_set_acl",
    description:
      "WHAT: Add, update, or remove calendar sharing (ACL insert/patch/delete).\n" +
      "WHEN: Share a calendar with a user/group or change reader/writer access.\n" +
      "Requires https://www.googleapis.com/auth/calendar scope.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["insert", "update", "delete"] },
        calendar_id: { type: "string" },
        rule_id: { type: "string", description: "ACL rule id (user:email@… or default) — required for update/delete." },
        role: {
          type: "string",
          enum: ["none", "freeBusyReader", "reader", "writer", "owner"],
          description: "Access role (insert/update).",
        },
        scope_type: { type: "string", enum: ["user", "group", "domain", "default"], description: "insert only." },
        scope_value: { type: "string", description: "Email, group id, or domain for scope." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const action = String(args["action"] ?? "").trim();
      const calId = encodeURIComponent(calendarIdArg(args));
      if (action === "insert") {
        const role = String(args["role"] ?? "").trim();
        const scopeType = String(args["scope_type"] ?? "user").trim();
        const scopeValue = String(args["scope_value"] ?? "").trim();
        if (!role) return { ok: false, error: "role is required for insert" };
        if (scopeType !== "default" && !scopeValue) {
          return { ok: false, error: "scope_value is required unless scope_type is default" };
        }
        const body = {
          role,
          scope: scopeType === "default" ? { type: "default" } : { type: scopeType, value: scopeValue },
        };
        const res = await calendarApiJson<unknown>(`/calendars/${calId}/acl`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: res.error };
        return jsonResult(res.data);
      }
      const ruleId = String(args["rule_id"] ?? "").trim();
      if (!ruleId) return { ok: false, error: "rule_id is required for update/delete" };
      const encRule = encodeURIComponent(ruleId);
      if (action === "delete") {
        const res = await calendarApiJson<unknown>(`/calendars/${calId}/acl/${encRule}`, { method: "DELETE" });
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, output: `Removed ACL rule ${ruleId}` };
      }
      if (action === "update") {
        const role = String(args["role"] ?? "").trim();
        if (!role) return { ok: false, error: "role is required for update" };
        const res = await calendarApiJson<unknown>(`/calendars/${calId}/acl/${encRule}`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        });
        if (!res.ok) return { ok: false, error: res.error };
        return jsonResult(res.data);
      }
      return { ok: false, error: `unknown action '${action}'` };
    },
  });

  return [
    calendarRestGetCalendar,
    calendarRestListCalendars,
    calendarRestListSettings,
    calendarRestGetSetting,
    calendarRestSetTimezone,
    calendarRestListColors,
    calendarRestPatchCalendarList,
    calendarRestSubscribeCalendar,
    calendarRestUnsubscribeCalendar,
    calendarRestClearCalendar,
    calendarRestFreebusy,
    calendarRestListAcl,
    calendarRestSetAcl,
    calendarRestListEvents,
    calendarRestGetEvent,
    calendarRestListInstances,
    calendarRestQuickAdd,
    calendarRestManageCalendar,
    calendarRestInsertEvent,
    calendarRestPatchEvent,
    calendarRestReplaceEvent,
    calendarRestDeleteEvent,
    calendarRestMoveEvent,
    calendarRestImportEvent,
    calendarRestRespondToEvent,
  ];
}
