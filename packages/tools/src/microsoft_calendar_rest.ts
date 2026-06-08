/**
 * Microsoft Calendar REST supplements — events, free/busy, Teams meetings.
 */
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function microsoftCalendarRestEnabled(): boolean {
  return microsoftRestEnabled();
}

function calendarPath(args: Record<string, unknown>, suffix = ""): string {
  const calId = String(args["calendar_id"] ?? "").trim();
  const base = calId ? `/me/calendars/${encodeURIComponent(calId)}` : "/me/calendar";
  return `${base}${suffix}`;
}

const eventProps: Record<string, PropertySchema> = {
  calendar_id: { type: "string", description: "Calendar id (default: primary)." },
  subject: { type: "string" },
  body_html: { type: "string" },
  body_text: { type: "string" },
  start: { type: "string", description: "ISO 8601 local datetime e.g. 2026-06-07T10:00:00" },
  end: { type: "string", description: "ISO 8601 local datetime." },
  timezone: { type: "string", description: "IANA timezone e.g. America/New_York (default UTC)." },
  location: { type: "string" },
  attendees: {
    type: "array",
    items: { type: "string" },
    description: "Email addresses.",
  },
  is_online_meeting: {
    type: "boolean",
    description: "Create Teams online meeting link.",
  },
  recurrence: { type: "object", description: "Graph recurrence object." },
};

export function createMicrosoftCalendarRestTools(): ToolDefinition[] {
  const listEvents = defineTool({
    name: "outlook_calendar_rest_list_events",
    description: "List calendar events in a time range.",
    parameters: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        start_datetime: { type: "string", description: "ISO filter start." },
        end_datetime: { type: "string", description: "ISO filter end." },
        top: { type: "number" },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftCalendarRestEnabled()) {
        return graphErrorResult("Microsoft Calendar REST is off.");
      }
      const filters: string[] = [];
      const start = String(args["start_datetime"] ?? "").trim();
      const end = String(args["end_datetime"] ?? "").trim();
      if (start) filters.push(`start/dateTime ge '${start}'`);
      if (end) filters.push(`end/dateTime le '${end}'`);
      const filter = filters.length ? `?$filter=${encodeURIComponent(filters.join(" and "))}` : "";
      const top = args["top"] != null ? `&$top=${Number(args["top"])}` : "";
      const path = `${calendarPath(args)}/events${filter}${top}`;
      const result = await graphApiJson(path.replace("?&", "?"));
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const createEvent = defineTool({
    name: "outlook_calendar_rest_create_event",
    description: "Create a calendar event; set is_online_meeting for Teams link.",
    parameters: {
      type: "object",
      properties: eventProps,
      required: ["subject", "start", "end"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftCalendarRestEnabled()) return graphErrorResult("Microsoft Calendar REST is off.");
      const tz = String(args["timezone"] ?? "UTC").trim();
      const body: Record<string, unknown> = {
        subject: String(args["subject"] ?? ""),
        start: { dateTime: String(args["start"]), timeZone: tz },
        end: { dateTime: String(args["end"]), timeZone: tz },
      };
      const html = String(args["body_html"] ?? "").trim();
      const text = String(args["body_text"] ?? "").trim();
      if (html || text) {
        body.body = { contentType: html ? "HTML" : "Text", content: html || text };
      }
      const loc = String(args["location"] ?? "").trim();
      if (loc) body.location = { displayName: loc };
      const attendees = Array.isArray(args["attendees"])
        ? (args["attendees"] as unknown[])
            .map((a) => String(a).trim())
            .filter(Boolean)
            .map((email) => ({
              emailAddress: { address: email },
              type: "required",
            }))
        : [];
      if (attendees.length) body.attendees = attendees;
      if (args["is_online_meeting"] === true) {
        body.isOnlineMeeting = true;
        body.onlineMeetingProvider = "teamsForBusiness";
      }
      if (args["recurrence"] && typeof args["recurrence"] === "object") {
        body.recurrence = args["recurrence"];
      }
      const result = await graphApiJson(`${calendarPath(args)}/events`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const findMeetingTimes = defineTool({
    name: "outlook_calendar_rest_find_meeting_times",
    description: "Suggest meeting times for attendees (Graph findMeetingTimes).",
    parameters: {
      type: "object",
      properties: {
        attendees: { type: "array", items: { type: "string" } },
        duration_minutes: { type: "number" },
        start_window: { type: "string", description: "ISO start of search window." },
        end_window: { type: "string", description: "ISO end of search window." },
        timezone: { type: "string" },
      },
      required: ["attendees", "duration_minutes", "start_window", "end_window"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftCalendarRestEnabled()) return graphErrorResult("Microsoft Calendar REST is off.");
      const tz = String(args["timezone"] ?? "UTC").trim();
      const attendees = (Array.isArray(args["attendees"]) ? args["attendees"] : []).map((e) => ({
        type: "required",
        emailAddress: { address: String(e) },
      }));
      const payload = {
        attendees,
        timeConstraint: {
          activityDomain: "work",
          timeSlots: [
            {
              start: { dateTime: String(args["start_window"]), timeZone: tz },
              end: { dateTime: String(args["end_window"]), timeZone: tz },
            },
          ],
        },
        meetingDuration: `PT${Number(args["duration_minutes"])}M`,
      };
      const result = await graphApiJson("/me/findMeetingTimes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const getSchedule = defineTool({
    name: "outlook_calendar_rest_get_schedule",
    description: "Get free/busy schedule for users.",
    parameters: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "string" } },
        start: { type: "string" },
        end: { type: "string" },
        timezone: { type: "string" },
      },
      required: ["emails", "start", "end"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftCalendarRestEnabled()) return graphErrorResult("Microsoft Calendar REST is off.");
      const tz = String(args["timezone"] ?? "UTC").trim();
      const emails = Array.isArray(args["emails"]) ? args["emails"].map(String) : [];
      const payload = {
        schedules: emails,
        startTime: { dateTime: String(args["start"]), timeZone: tz },
        endTime: { dateTime: String(args["end"]), timeZone: tz },
        availabilityViewInterval: 30,
      };
      const result = await graphApiJson("/me/calendar/getSchedule", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [listEvents, createEvent, findMeetingTimes, getSchedule];
}
