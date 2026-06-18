/**
 * YouTube Analytics API v2 — Studio-style reports (watch time, traffic, revenue when scoped).
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { jsonToolResult, qs, youtubeAnalyticsJson, youtubeRestEnabled, youtubeRestJson } from "./youtube_rest_http.js";
import { youtubeAnalyticsScopeError, splitAnalyticsMetrics } from "./youtube_analytics_metrics.js";
import {
  formatAnalyticsTable,
  resolveAnalyticsPreset,
  validateAnalyticsMetricsList,
  type AnalyticsReportPreset,
} from "./youtube_format.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateArg(raw: unknown, label: string): string | ToolResult {
  const s = String(raw ?? "").trim();
  if (!DATE_RE.test(s)) {
    return { ok: false, error: `${label} required (YYYY-MM-DD).` };
  }
  return s;
}

async function runAnalyticsQuery(args: {
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults: number;
  ids?: string;
}): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  return youtubeAnalyticsJson<unknown>(
    `/reports${qs({
      ids: args.ids?.trim() || "channel==MINE",
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: args.metrics,
      dimensions: args.dimensions?.trim() || undefined,
      filters: args.filters?.trim() || undefined,
      sort: args.sort?.trim() || undefined,
      maxResults: args.maxResults,
    })}`
  );
}

async function enrichVideoTitles(rows: Array<Record<string, string | number>>): Promise<void> {
  const ids = rows
    .map((r) => String(r.video ?? "").trim())
    .filter(Boolean);
  if (ids.length === 0) return;
  const unique = [...new Set(ids)].slice(0, 50);
  const res = await youtubeRestJson<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>(
    `/videos${qs({ part: "snippet", id: unique.join(",") })}`
  );
  if (!res.ok) return;
  const titles = new Map<string, string>();
  for (const item of res.data.items ?? []) {
    if (item.id) titles.set(item.id, String(item.snippet?.title ?? ""));
  }
  for (const row of rows) {
    const id = String(row.video ?? "");
    if (id && titles.has(id)) row.videoTitle = titles.get(id)!;
  }
}

export function createYoutubeAnalyticsRestTools(): ToolDefinition[] {
  const youtubeAnalyticsReport = defineTool({
    name: "youtube_analytics_report",
    description:
      "WHAT: Run a curated YouTube Studio analytics report with safe metrics and labeled output.\n" +
      "WHEN: User asks how the channel or a video performed — views, watch time, likes, subs, traffic.\n" +
      "PRESETS: channel_daily (views by day), top_videos (rank by views), video_daily (one video), traffic_sources, engagement_summary (period totals).\n" +
      "IMPORTANT: views ≠ likes. Period views here differ from lifetime viewCount on youtube_rest_get_video.\n" +
      "Prefer this over youtube_analytics_query for standard reporting.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date YYYY-MM-DD (inclusive)." },
        end_date: { type: "string", description: "End date YYYY-MM-DD (inclusive)." },
        report_type: {
          type: "string",
          enum: ["channel_daily", "top_videos", "video_daily", "traffic_sources", "engagement_summary"],
          description: "Preset report shape with correct metrics/dimensions.",
        },
        video_id: {
          type: "string",
          description: "Required for video_daily — YouTube video id.",
        },
        max_results: { type: "number", description: "Max rows (preset default applies)." },
      },
      required: ["start_date", "end_date", "report_type"],
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
      const preset = String(args["report_type"] ?? "").trim() as AnalyticsReportPreset;
      if (!preset) return { ok: false, error: "report_type required" };
      const spec = resolveAnalyticsPreset(preset);
      let filters = spec.filters;
      if (preset === "video_daily") {
        const videoId = String(args["video_id"] ?? "").trim();
        if (!videoId) return { ok: false, error: "video_id required for video_daily report" };
        filters = `video==${videoId}`;
      }
      const metrics = spec.metrics;
      const metricErr = validateAnalyticsMetricsList(splitAnalyticsMetrics(metrics));
      if (metricErr) return { ok: false, error: metricErr };
      const scopeErr = await youtubeAnalyticsScopeError(metrics);
      if (scopeErr) return { ok: false, error: scopeErr };
      const max = Math.min(
        200,
        Math.max(1, Number(args["max_results"]) || spec.maxResults)
      );
      const res = await runAnalyticsQuery({
        startDate: start,
        endDate: end,
        metrics,
        dimensions: spec.dimensions,
        filters,
        sort: spec.sort,
        maxResults: max,
      });
      if (!res.ok) return { ok: false, error: res.error };
      const formatted = formatAnalyticsTable(res.data, {
        startDate: start,
        endDate: end,
        metrics,
        dimensions: spec.dimensions,
      });
      if (preset === "top_videos" && Array.isArray(formatted.rows)) {
        await enrichVideoTitles(formatted.rows as Array<Record<string, string | number>>);
      }
      return jsonToolResult({
        reportType: preset,
        reportDescription: spec.description,
        ...formatted,
      });
    },
  });

  const youtubeAnalyticsQuery = defineTool({
    name: "youtube_analytics_query",
    description:
      "WHAT: Low-level YouTube Analytics API query (advanced — prefer youtube_analytics_report).\n" +
      "WHEN: Custom dimensions/filters not covered by presets.\n" +
      "METRICS: views (watch count), likes (like actions), comments, shares, estimatedMinutesWatched, subscribersGained. " +
      "views and likes are separate — never interchange. Do NOT use bare impressions.\n" +
      "OUTPUT: Rows are labeled by column name with period totals and metric glossary.\n" +
      "API: https://developers.google.com/youtube/analytics/reference/reports/query",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date YYYY-MM-DD (inclusive)." },
        end_date: { type: "string", description: "End date YYYY-MM-DD (inclusive)." },
        metrics: {
          type: "string",
          description:
            "Comma-separated metrics, e.g. views,estimatedMinutesWatched,likes,comments,subscribersGained",
        },
        dimensions: {
          type: "string",
          description: "Optional comma-separated dimensions, e.g. day, video, country, insightTrafficSourceType",
        },
        filters: { type: "string", description: "Optional Analytics API filters expression, e.g. video==abc123." },
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
      const metricErr = validateAnalyticsMetricsList(splitAnalyticsMetrics(metrics));
      if (metricErr) return { ok: false, error: metricErr };
      const scopeErr = await youtubeAnalyticsScopeError(metrics);
      if (scopeErr) return { ok: false, error: scopeErr };
      const dimensions = String(args["dimensions"] ?? "").trim() || undefined;
      const max = Math.min(200, Math.max(1, Number(args["max_results"]) || 100));
      const res = await runAnalyticsQuery({
        startDate: start,
        endDate: end,
        metrics,
        dimensions,
        filters: String(args["filters"] ?? "").trim() || undefined,
        sort: String(args["sort"] ?? "").trim() || undefined,
        maxResults: max,
        ids: String(args["ids"] ?? "").trim() || undefined,
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(
        formatAnalyticsTable(res.data, {
          startDate: start,
          endDate: end,
          metrics,
          dimensions,
        })
      );
    },
  });

  return [youtubeAnalyticsReport, youtubeAnalyticsQuery];
}

export { youtubeRestEnabled };
