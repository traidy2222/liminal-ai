/**
 * Notion REST API tools (OAuth integration token).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, getNotionAccessToken, listNotionOAuthAccounts } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { integrationNotConnectedError } from "./integration_oauth_start.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export function notionRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_NOTION_REST") !== "0";
}

async function resolveNotionToken(accountHint?: string): Promise<string | null> {
  const accounts = await listNotionOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.email?.toLowerCase() === accountHint.toLowerCase() ||
          a.workspaceName?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  return getNotionAccessToken(match?.accountId ?? accounts[0]?.accountId);
}

async function notionApi(
  path: string,
  opts: { method?: string; body?: unknown; accountHint?: string }
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await resolveNotionToken(opts.accountHint);
  if (!token) {
    return {
      ok: false,
      error: integrationNotConnectedError("notion"),
    };
  }
  const res = await fetch(`${NOTION_API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json()) as { message?: string; [key: string]: unknown };
  if (!res.ok) {
    return { ok: false, error: data.message ?? `Notion HTTP ${res.status}` };
  }
  return { ok: true, data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function parseJsonArg(raw: unknown, label: string): unknown | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { error: `${label} must be valid JSON` };
  }
}

export function registerNotionRestTools(registry: ToolRegistry): void {
  if (!notionRestEnabled()) return;

  registry.register(
    defineTool({
      name: "notion_search",
      description:
        "WHEN: User asks to find Notion pages or databases.\n" +
        "HOW: Full-text search across shared workspace content.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text." },
          filter: {
            type: "string",
            enum: ["page", "database"],
            description: "Limit to pages or databases.",
          },
          limit: { type: "number" },
          account_hint: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const query = String(args["query"] ?? "").trim();
        if (!query) return { ok: false, error: "query required" };
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 20));
        const filterType = args["filter"] === "database" ? "database" : args["filter"] === "page" ? "page" : undefined;
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const body: Record<string, unknown> = { query, page_size: limit };
        if (filterType) {
          body.filter = { value: filterType, property: "object" };
        }
        const result = await notionApi("/search", { method: "POST", body, accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_get_page",
      description: "WHEN: User needs a Notion page title, properties, or metadata. HOW: page_id uuid.",
      parameters: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["page_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 20_000,
      handler: async (args): Promise<ToolResult> => {
        const pageId = String(args["page_id"] ?? "").trim();
        if (!pageId) return { ok: false, error: "page_id required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result = await notionApi(`/pages/${pageId}`, { accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_list_block_children",
      description:
        "WHEN: User wants page body content from Notion.\n" +
        "HOW: Lists child blocks for page_id (paginate with start_cursor if needed).",
      parameters: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          start_cursor: { type: "string" },
          limit: { type: "number" },
          account_hint: { type: "string" },
        },
        required: ["page_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const pageId = String(args["page_id"] ?? "").trim();
        if (!pageId) return { ok: false, error: "page_id required" };
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 50));
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const params = new URLSearchParams({ page_size: String(limit) });
        const cursor = typeof args["start_cursor"] === "string" ? args["start_cursor"].trim() : "";
        if (cursor) params.set("start_cursor", cursor);
        const result = await notionApi(`/blocks/${pageId}/children?${params}`, { accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_get_database",
      description: "WHEN: User needs database schema or title. HOW: database_id uuid.",
      parameters: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["database_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const databaseId = String(args["database_id"] ?? "").trim();
        if (!databaseId) return { ok: false, error: "database_id required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result = await notionApi(`/databases/${databaseId}`, { accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_query_database",
      description:
        "WHEN: User wants rows from a Notion database.\n" +
        "HOW: database_id plus optional filter/sorts JSON (Notion API shape).",
      parameters: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          filter: { type: "string", description: "JSON filter object." },
          sorts: { type: "string", description: "JSON array of sort objects." },
          limit: { type: "number" },
          start_cursor: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["database_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const databaseId = String(args["database_id"] ?? "").trim();
        if (!databaseId) return { ok: false, error: "database_id required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 25));
        const body: Record<string, unknown> = { page_size: limit };
        const filter = parseJsonArg(args["filter"], "filter");
        if (filter && typeof filter === "object" && "error" in filter) {
          return { ok: false, error: String(filter.error) };
        }
        if (filter) body.filter = filter;
        const sorts = parseJsonArg(args["sorts"], "sorts");
        if (sorts && typeof sorts === "object" && "error" in sorts) {
          return { ok: false, error: String(sorts.error) };
        }
        if (sorts) body.sorts = sorts;
        const cursor = typeof args["start_cursor"] === "string" ? args["start_cursor"].trim() : "";
        if (cursor) body.start_cursor = cursor;
        const result = await notionApi(`/databases/${databaseId}/query`, {
          method: "POST",
          body,
          accountHint: hint,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_create_page",
      description:
        "WHEN: User asks to create a Notion page or database row.\n" +
        "HOW: parent as JSON { type, page_id|database_id } plus properties JSON.",
      parameters: {
        type: "object",
        properties: {
          parent: { type: "string", description: "JSON parent object." },
          properties: { type: "string", description: "JSON properties object." },
          children: { type: "string", description: "Optional JSON array of block objects." },
          account_hint: { type: "string" },
        },
        required: ["parent", "properties"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const parent = parseJsonArg(args["parent"], "parent");
        if (!parent || (typeof parent === "object" && "error" in parent)) {
          return { ok: false, error: typeof parent === "object" && parent && "error" in parent ? String(parent.error) : "parent required" };
        }
        const properties = parseJsonArg(args["properties"], "properties");
        if (!properties || (typeof properties === "object" && "error" in properties)) {
          return { ok: false, error: typeof properties === "object" && properties && "error" in properties ? String(properties.error) : "properties required" };
        }
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const body: Record<string, unknown> = { parent, properties };
        const children = parseJsonArg(args["children"], "children");
        if (children && typeof children === "object" && "error" in children) {
          return { ok: false, error: String(children.error) };
        }
        if (children) body.children = children;
        const result = await notionApi("/pages", { method: "POST", body, accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_update_page",
      description: "WHEN: User asks to update Notion page properties. HOW: page_id plus properties JSON.",
      parameters: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          properties: { type: "string", description: "JSON properties object." },
          archived: { type: "boolean" },
          account_hint: { type: "string" },
        },
        required: ["page_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const pageId = String(args["page_id"] ?? "").trim();
        if (!pageId) return { ok: false, error: "page_id required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const body: Record<string, unknown> = {};
        const properties = parseJsonArg(args["properties"], "properties");
        if (properties && typeof properties === "object" && "error" in properties) {
          return { ok: false, error: String(properties.error) };
        }
        if (properties) body.properties = properties;
        if (typeof args["archived"] === "boolean") body.archived = args["archived"];
        const result = await notionApi(`/pages/${pageId}`, { method: "PATCH", body, accountHint: hint });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "notion_append_blocks",
      description:
        "WHEN: User asks to add content to a Notion page.\n" +
        "HOW: block_id (page or block) plus children JSON array of block objects.",
      parameters: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          children: { type: "string", description: "JSON array of block objects." },
          account_hint: { type: "string" },
        },
        required: ["block_id", "children"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const blockId = String(args["block_id"] ?? "").trim();
        if (!blockId) return { ok: false, error: "block_id required" };
        const children = parseJsonArg(args["children"], "children");
        if (!children || (typeof children === "object" && "error" in children)) {
          return { ok: false, error: typeof children === "object" && children && "error" in children ? String(children.error) : "children required" };
        }
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result = await notionApi(`/blocks/${blockId}/children`, {
          method: "PATCH",
          body: { children },
          accountHint: hint,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}
