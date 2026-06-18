/**
 * YouTube Analytics API v2 — Studio-style reports (watch time, traffic, revenue when scoped).
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { jsonToolResult, qs, youtubeAnalyticsJson, youtubeRestEnabled } from "./youtube_rest_http.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateArg(raw: unknown, label: string): string | ToolResult {
  const s = String(raw ?? "").trim();
  if (!DATE_RE.test(s)) {
    return { ok: false, error: `${label} required (YYYY-MM-DD).` };
  }
  return s;
}

export function createYoutubeAnalyticsRestTools(): ToolDefinition[] {
  const youtubeAnalyticsQuery = defineTool({
    name: "youtube_analytics_query",
    description:
      "WHAT: Query YouTube Analytics (Studio metrics) for the connected channel.\n" +
      "WHEN: Watch time, views by day, traffic sources, demographics, impressions/CTR, or revenue (if monetary scope granted).\n" +
      "API: https://developers.google.com/youtube/analytics/reference/reports/query",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date YYYY-MM-DD (inclusive)." },
        end_date: { type: "string", description: "End date YYYY-MM-DD (inclusive)." },
        metrics: {
          type: "string",
          description:
            "Comma-separated metrics, e.g. views,estimatedMinutesWatched,subscribersGained,impressions,estimatedRevenue",
        },
        dimensions: {
          type: "string",
          description: "Optional comma-separated dimensions, e.g. day, country, insightTrafficSourceType",
        },
        filters: { type: "string", description: "Optional Analytics API filters expression." },
        sort: { type: "string", description: "Optional sort, e.g. -views" },
        max_results: { type: "number", description: "Max rows (default 100, max 200)." },
        ids: {
          type: "string",
          description: 'Channel selector (default "channel==MINE").',
        },
      },
      required: ["start_date", "end_date", "metrics"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 300_000,
    handler: async (args): Promise<ToolResult> => {
      const start = parseDateArg(args["start_date"], "start_date");
      if (typeof start !== "string") return start;
      const end = parseDateArg(args["end_date"], "end_date");
      if (typeof end !== "string") return end;
      const metrics = String(args["metrics"] ?? "").trim();
      if (!metrics) return { ok: false, error: "metrics required" };
      const max = Math.min(200, Math.max(1, Number(args["max_results"]) || 100));
      const res = await youtubeAnalyticsJson<unknown>(
        `/reports${qs({
          ids: String(args["ids"] ?? "").trim() || "channel==MINE",
          startDate: start,
          endDate: end,
          metrics,
          dimensions: String(args["dimensions"] ?? "").trim() || undefined,
          filters: String(args["filters"] ?? "").trim() || undefined,
          sort: String(args["sort"] ?? "").trim() || undefined,
          maxResults: max,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  return [youtubeAnalyticsQuery];
}

export { youtubeRestEnabled };
