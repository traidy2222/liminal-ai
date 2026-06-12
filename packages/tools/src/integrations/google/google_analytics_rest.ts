/**
 * Google Analytics 4 — Admin + Data API REST tools (accounts, properties, reports, management).
 */
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  googleRestEnvEnabled,
  googleRestJson,
  jsonToolResult,
  normalizeGa4PropertyId,
  qs,
} from "./google_rest_http.js";

const ENV_KEY = "AGENT_GOOGLE_ANALYTICS_REST";
const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";

export function analyticsRestEnabled(): boolean {
  return googleRestEnvEnabled(ENV_KEY);
}

function objectSchema(description: string): PropertySchema {
  return { type: "object", description, additionalProperties: true } as PropertySchema;
}

function arraySchema(description: string): PropertySchema {
  return { type: "array", description, items: { type: "object", additionalProperties: true } } as PropertySchema;
}

async function adminApi<T>(path: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `${ADMIN_BASE}${path}`;
  return googleRestJson<T>(url, { envKey: ENV_KEY, serviceLabel: "Analytics Admin", init });
}

async function dataApi<T>(path: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `${DATA_BASE}${path}`;
  return googleRestJson<T>(url, { envKey: ENV_KEY, serviceLabel: "Analytics Data", init });
}

function propertyIdArg(args: Record<string, unknown>): string {
  return normalizeGa4PropertyId(String(args["property_id"] ?? ""));
}

export function createGoogleAnalyticsRestTools(): ToolDefinition[] {
  const analyticsRestListAccountSummaries = defineTool({
    name: "analytics_rest_list_account_summaries",
    description:
      "WHAT: List GA4 account summaries (accounts + nested property summaries).\n" +
      "WHEN: First step — discover account/property ids before run_report or admin changes.",
    parameters: {
      type: "object",
      properties: {
        page_size: { type: "number", description: "Max results per page (default 200)." },
        page_token: { type: "string" },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (args): Promise<ToolResult> => {
      const res = await adminApi<unknown>(
        `/accountSummaries${qs({
          pageSize: args["page_size"] as number | undefined,
          pageToken: String(args["page_token"] ?? "") || undefined,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestListProperties = defineTool({
    name: "analytics_rest_list_properties",
    description:
      "WHAT: List GA4 properties under an account (analyticsadmin.properties.list).\n" +
      "WHEN: User names an account id from list_account_summaries.",
    parameters: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Account id (numeric or accounts/123).",
        },
        page_size: { type: "number" },
        page_token: { type: "string" },
        show_deleted: { type: "boolean" },
      },
      required: ["account_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (args): Promise<ToolResult> => {
      const raw = String(args["account_id"] ?? "").trim();
      const parent = raw.startsWith("accounts/") ? raw : `accounts/${raw.replace(/\D/g, "")}`;
      const res = await adminApi<unknown>(
        `/properties${qs({
          filter: `parent:${parent}`,
          pageSize: args["page_size"] as number | undefined,
          pageToken: String(args["page_token"] ?? "") || undefined,
          showDeleted: args["show_deleted"] === true ? true : undefined,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestGetProperty = defineTool({
    name: "analytics_rest_get_property",
    description: "WHAT: Get GA4 property metadata (display name, timezone, currency, industry).\n" +
      "WHEN: Verify property settings before reporting or admin edits.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property id (numeric or properties/123)." },
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const res = await adminApi<unknown>(`/${propertyIdArg(args)}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestUpdateProperty = defineTool({
    name: "analytics_rest_update_property",
    description:
      "WHAT: Patch GA4 property settings (displayName, timeZone, currencyCode, industryCategory).\n" +
      "WHEN: User explicitly asks to rename or reconfigure a GA4 property.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        display_name: { type: "string" },
        time_zone: { type: "string", description: "IANA timezone, e.g. America/Los_Angeles." },
        currency_code: { type: "string", description: "ISO 4217, e.g. USD." },
        industry_category: { type: "string" },
        update_mask: {
          type: "string",
          description: "Comma-separated fields to update (auto-built from provided fields if omitted).",
        },
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      const prop = propertyIdArg(args);
      const body: Record<string, unknown> = { name: prop };
      const mask: string[] = [];
      if (args["display_name"]) {
        body.displayName = String(args["display_name"]);
        mask.push("displayName");
      }
      if (args["time_zone"]) {
        body.timeZone = String(args["time_zone"]);
        mask.push("timeZone");
      }
      if (args["currency_code"]) {
        body.currencyCode = String(args["currency_code"]);
        mask.push("currencyCode");
      }
      if (args["industry_category"]) {
        body.industryCategory = String(args["industry_category"]);
        mask.push("industryCategory");
      }
      const updateMask =
        String(args["update_mask"] ?? "").trim() || mask.join(",");
      if (!updateMask) {
        return { ok: false, error: "Provide at least one field to update or update_mask." };
      }
      const res = await adminApi<unknown>(
        `/${prop}?updateMask=${encodeURIComponent(updateMask)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestListDataStreams = defineTool({
    name: "analytics_rest_list_data_streams",
    description:
      "WHAT: List web/app data streams for a GA4 property.\n" +
      "WHEN: Debugging measurement, finding stream ids, or verifying web stream URLs.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        page_size: { type: "number" },
        page_token: { type: "string" },
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const parent = propertyIdArg(args);
      const res = await adminApi<unknown>(
        `/${parent}/dataStreams${qs({
          pageSize: args["page_size"] as number | undefined,
          pageToken: String(args["page_token"] ?? "") || undefined,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestListCustomDimensions = defineTool({
    name: "analytics_rest_list_custom_dimensions",
    description: "WHAT: List custom dimensions on a GA4 property.\n" +
      "WHEN: Before creating dimensions or building reports that reference them.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        page_size: { type: "number" },
        page_token: { type: "string" },
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const parent = propertyIdArg(args);
      const res = await adminApi<unknown>(
        `/${parent}/customDimensions${qs({
          pageSize: args["page_size"] as number | undefined,
          pageToken: String(args["page_token"] ?? "") || undefined,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestCreateCustomDimension = defineTool({
    name: "analytics_rest_create_custom_dimension",
    description:
      "WHAT: Create a GA4 custom dimension (event or user scope).\n" +
      "WHEN: User asks to add tracking for a new parameter in GA4 admin.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        display_name: { type: "string" },
        parameter_name: { type: "string", description: "Event parameter name in snake_case." },
        scope: {
          type: "string",
          enum: ["EVENT", "USER"],
          description: "Dimension scope (default EVENT).",
        },
        description: { type: "string" },
      },
      required: ["property_id", "display_name", "parameter_name"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      const parent = propertyIdArg(args);
      const body = {
        displayName: String(args["display_name"]),
        parameterName: String(args["parameter_name"]),
        scope: String(args["scope"] ?? "EVENT"),
        description: args["description"] ? String(args["description"]) : undefined,
      };
      const res = await adminApi<unknown>(`/${parent}/customDimensions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestGetMetadata = defineTool({
    name: "analytics_rest_get_metadata",
    description:
      "WHAT: List available dimensions and metrics for a GA4 property (Data API metadata).\n" +
      "WHEN: Before run_report — validate dimension/metric names and compatibility.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 300_000,
    handler: async (args): Promise<ToolResult> => {
      const res = await dataApi<unknown>(`/${propertyIdArg(args)}/metadata`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestRunReport = defineTool({
    name: "analytics_rest_run_report",
    description:
      "WHAT: Run a GA4 report (sessions, users, events, conversions, pages, sources, …).\n" +
      "WHEN: User asks for traffic, engagement, funnel, or custom analytics for a date range.\n" +
      "HOW: property_id from list_account_summaries; dates YYYY-MM-DD; dimensions/metrics as GA4 API names " +
      "(e.g. date, sessionDefaultChannelGroup, activeUsers, screenPageViews).",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD or relative: yesterday, 7daysAgo, 30daysAgo." },
        end_date: { type: "string", description: "YYYY-MM-DD or today, yesterday." },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Dimension API names, e.g. [\"date\", \"country\"].",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Metric API names, e.g. [\"activeUsers\", \"sessions\"].",
        },
        dimension_filter: objectSchema("Optional DimensionFilter JSON (GA4 Data API shape)."),
        metric_filter: objectSchema("Optional MetricFilter JSON."),
        order_bys: arraySchema("Optional orderBys array."),
        limit: { type: "number", description: "Row limit (default 100, max 100000)." },
        offset: { type: "number" },
        keep_empty_rows: { type: "boolean" },
        currency_code: { type: "string" },
      },
      required: ["property_id", "start_date", "end_date", "metrics"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const prop = propertyIdArg(args);
      const dimensions = Array.isArray(args["dimensions"])
        ? (args["dimensions"] as unknown[]).map((d) => ({ name: String(d) }))
        : undefined;
      const metrics = (args["metrics"] as unknown[]).map((m) => ({ name: String(m) }));
      const body: Record<string, unknown> = {
        dateRanges: [
          { startDate: String(args["start_date"]), endDate: String(args["end_date"]) },
        ],
        metrics,
        limit: typeof args["limit"] === "number" ? args["limit"] : 100,
        keepEmptyRows: args["keep_empty_rows"] === true,
      };
      if (dimensions?.length) body.dimensions = dimensions;
      if (args["dimension_filter"] && typeof args["dimension_filter"] === "object") {
        body.dimensionFilter = args["dimension_filter"];
      }
      if (args["metric_filter"] && typeof args["metric_filter"] === "object") {
        body.metricFilter = args["metric_filter"];
      }
      if (Array.isArray(args["order_bys"])) body.orderBys = args["order_bys"];
      if (typeof args["offset"] === "number") body.offset = args["offset"];
      if (args["currency_code"]) body.currencyCode = String(args["currency_code"]);

      const res = await dataApi<unknown>(`/${prop}:runReport`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestRunRealtimeReport = defineTool({
    name: "analytics_rest_run_realtime_report",
    description:
      "WHAT: GA4 realtime report (active users now, top pages/events in last ~30 minutes).\n" +
      "WHEN: User asks what is happening on the site right now.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Default activeUsers if omitted.",
        },
        limit: { type: "number" },
        minute_ranges: arraySchema("Optional minuteRanges, e.g. [{\"startMinutesAgo\":29,\"endMinutesAgo\":0}]."),
      },
      required: ["property_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: false,
    handler: async (args): Promise<ToolResult> => {
      const prop = propertyIdArg(args);
      const metrics = Array.isArray(args["metrics"])
        ? (args["metrics"] as unknown[]).map((m) => ({ name: String(m) }))
        : [{ name: "activeUsers" }];
      const body: Record<string, unknown> = { metrics };
      if (Array.isArray(args["dimensions"])) {
        body.dimensions = (args["dimensions"] as unknown[]).map((d) => ({ name: String(d) }));
      }
      if (typeof args["limit"] === "number") body.limit = args["limit"];
      if (Array.isArray(args["minute_ranges"])) body.minuteRanges = args["minute_ranges"];

      const res = await dataApi<unknown>(`/${prop}:runRealtimeReport`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const analyticsRestBatchRunReports = defineTool({
    name: "analytics_rest_batch_run_reports",
    description:
      "WHAT: Run multiple GA4 reports in one request (batchRunReports).\n" +
      "WHEN: Dashboard-style multi-query fetch to save round trips.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        requests: {
          type: "array",
          description: "Array of RunReportRequest objects (dateRanges, dimensions, metrics, …).",
          items: objectSchema("Single RunReportRequest."),
        },
      },
      required: ["property_id", "requests"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const prop = propertyIdArg(args);
      if (!Array.isArray(args["requests"]) || args["requests"].length === 0) {
        return { ok: false, error: "requests must be a non-empty array." };
      }
      const res = await dataApi<unknown>(`/${prop}:batchRunReports`, {
        method: "POST",
        body: JSON.stringify({ requests: args["requests"] }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  return [
    analyticsRestListAccountSummaries,
    analyticsRestListProperties,
    analyticsRestGetProperty,
    analyticsRestUpdateProperty,
    analyticsRestListDataStreams,
    analyticsRestListCustomDimensions,
    analyticsRestCreateCustomDimension,
    analyticsRestGetMetadata,
    analyticsRestRunReport,
    analyticsRestRunRealtimeReport,
    analyticsRestBatchRunReports,
  ];
}
