/**
 * Google Search Console — sites, search analytics, URL inspection, sitemaps.
 */
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { googleRestEnvEnabled, googleRestJson, jsonToolResult, qs } from "./google_rest_http.js";

const ENV_KEY = "AGENT_GOOGLE_SEARCH_CONSOLE_REST";
const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3";
const INSPECTION_BASE = "https://searchconsole.googleapis.com/v1";

export function searchConsoleRestEnabled(): boolean {
  return googleRestEnvEnabled(ENV_KEY);
}

function objectSchema(description: string): PropertySchema {
  return { type: "object", description, additionalProperties: true } as PropertySchema;
}

function encodeSiteUrl(siteUrl: string): string {
  return encodeURIComponent(siteUrl.trim());
}

async function webmastersApi<T>(path: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `${WEBMASTERS_BASE}${path}`;
  return googleRestJson<T>(url, { envKey: ENV_KEY, serviceLabel: "Search Console", init });
}

async function inspectionApi<T>(path: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `${INSPECTION_BASE}${path}`;
  return googleRestJson<T>(url, { envKey: ENV_KEY, serviceLabel: "Search Console URL Inspection", init });
}

export function createGoogleSearchConsoleRestTools(): ToolDefinition[] {
  const searchConsoleRestListSites = defineTool({
    name: "search_console_rest_list_sites",
    description:
      "WHAT: List Search Console properties (site URLs) the user can access.\n" +
      "WHEN: First step — get exact siteUrl values before query or sitemap tools.\n" +
      "NOTE: siteUrl is often `sc-domain:example.com` or `https://www.example.com/`.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (): Promise<ToolResult> => {
      const res = await webmastersApi<unknown>("/sites");
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const searchConsoleRestQuerySearchAnalytics = defineTool({
    name: "search_console_rest_query_search_analytics",
    description:
      "WHAT: Query Search Console performance (clicks, impressions, CTR, position) by query/page/country/device/date.\n" +
      "WHEN: SEO reporting, keyword research, or diagnosing ranking changes.\n" +
      "HOW: site_url from list_sites; dates YYYY-MM-DD; dimensions e.g. query, page, country, device, date.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string", description: "Exact site URL from list_sites." },
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
        dimensions: {
          type: "array",
          items: {
            type: "string",
            enum: ["query", "page", "country", "device", "date", "searchAppearance"],
          },
        },
        dimension_filter_groups: arraySchema("Optional DimensionFilterGroup[] (API shape)."),
        aggregation_type: {
          type: "string",
          enum: ["auto", "byPage", "byProperty"],
        },
        row_limit: { type: "number", description: "Default 1000, max 25000." },
        start_row: { type: "number" },
        search_type: {
          type: "string",
          enum: ["web", "image", "video", "news", "discover", "googleNews"],
          description: "Default web.",
        },
        data_state: {
          type: "string",
          enum: ["final", "all"],
          description: "final = settled data only (default).",
        },
      },
      required: ["site_url", "start_date", "end_date"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const site = encodeSiteUrl(String(args["site_url"]));
      const body: Record<string, unknown> = {
        startDate: String(args["start_date"]),
        endDate: String(args["end_date"]),
        rowLimit: typeof args["row_limit"] === "number" ? args["row_limit"] : 1000,
      };
      if (Array.isArray(args["dimensions"])) body.dimensions = args["dimensions"];
      if (Array.isArray(args["dimension_filter_groups"])) {
        body.dimensionFilterGroups = args["dimension_filter_groups"];
      }
      if (args["aggregation_type"]) body.aggregationType = String(args["aggregation_type"]);
      if (typeof args["start_row"] === "number") body.startRow = args["start_row"];
      if (args["search_type"]) body.type = String(args["search_type"]);
      if (args["data_state"]) body.dataState = String(args["data_state"]);

      const res = await webmastersApi<unknown>(`/sites/${site}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const searchConsoleRestInspectUrl = defineTool({
    name: "search_console_rest_inspect_url",
    description:
      "WHAT: URL Inspection — index status, crawl info, canonical, rich results for a URL.\n" +
      "WHEN: Debugging why a page is not indexed or checking live URL state in Google.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string", description: "Property URL from list_sites." },
        inspection_url: { type: "string", description: "Full URL to inspect (must belong to property)." },
        language_code: { type: "string", description: "Optional BCP-47 language (default en-US)." },
      },
      required: ["site_url", "inspection_url"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const body = {
        inspectionUrl: String(args["inspection_url"]),
        siteUrl: String(args["site_url"]),
        languageCode: String(args["language_code"] ?? "en-US"),
      };
      const res = await inspectionApi<unknown>("/urlInspection/index:inspect", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const searchConsoleRestListSitemaps = defineTool({
    name: "search_console_rest_list_sitemaps",
    description: "WHAT: List sitemaps submitted for a Search Console property.\n" +
      "WHEN: Auditing sitemap coverage or before submit/delete.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string" },
        sitemap_index: {
          type: "string",
          description: "Optional filter — sitemap index URL.",
        },
      },
      required: ["site_url"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const site = encodeSiteUrl(String(args["site_url"]));
      const res = await webmastersApi<unknown>(
        `/sites/${site}/sitemaps${qs({
          sitemapIndex: String(args["sitemap_index"] ?? "") || undefined,
        })}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const searchConsoleRestGetSitemap = defineTool({
    name: "search_console_rest_get_sitemap",
    description: "WHAT: Get metadata for one submitted sitemap (errors, warnings, counts).\n" +
      "WHEN: Diagnosing sitemap processing issues.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string" },
        feedpath: {
          type: "string",
          description: "Sitemap URL path, e.g. https://example.com/sitemap.xml",
        },
      },
      required: ["site_url", "feedpath"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const site = encodeSiteUrl(String(args["site_url"]));
      const feed = encodeURIComponent(String(args["feedpath"]));
      const res = await webmastersApi<unknown>(`/sites/${site}/sitemaps/${feed}`);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const searchConsoleRestSubmitSitemap = defineTool({
    name: "search_console_rest_submit_sitemap",
    description:
      "WHAT: Submit a sitemap URL to Search Console for crawling.\n" +
      "WHEN: User publishes a new sitemap or wants Google to recrawl it.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string" },
        feedpath: { type: "string", description: "Full sitemap URL to submit." },
      },
      required: ["site_url", "feedpath"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      const site = encodeSiteUrl(String(args["site_url"]));
      const feed = encodeURIComponent(String(args["feedpath"]));
      const res = await webmastersApi<unknown>(`/sites/${site}/sitemaps/${feed}`, {
        method: "PUT",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data ?? { submitted: true, feedpath: args["feedpath"] });
    },
  });

  const searchConsoleRestDeleteSitemap = defineTool({
    name: "search_console_rest_delete_sitemap",
    description: "WHAT: Remove a sitemap from Search Console (does not delete the file on your server).\n" +
      "WHEN: User wants to stop Google from using an outdated sitemap entry.",
    parameters: {
      type: "object",
      properties: {
        site_url: { type: "string" },
        feedpath: { type: "string" },
      },
      required: ["site_url", "feedpath"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const site = encodeSiteUrl(String(args["site_url"]));
      const feed = encodeURIComponent(String(args["feedpath"]));
      const res = await webmastersApi<unknown>(`/sites/${site}/sitemaps/${feed}`, {
        method: "DELETE",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult({ deleted: true, feedpath: args["feedpath"] });
    },
  });

  return [
    searchConsoleRestListSites,
    searchConsoleRestQuerySearchAnalytics,
    searchConsoleRestInspectUrl,
    searchConsoleRestListSitemaps,
    searchConsoleRestGetSitemap,
    searchConsoleRestSubmitSitemap,
    searchConsoleRestDeleteSitemap,
  ];
}

function arraySchema(description: string): PropertySchema {
  return { type: "array", description, items: { type: "object", additionalProperties: true } } as PropertySchema;
}
