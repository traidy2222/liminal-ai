/**
 * Microsoft Search unified query REST.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function graphSearchRestEnabled(): boolean {
  return microsoftRestEnabled();
}

export function createGraphSearchRestTools(): ToolDefinition[] {
  const searchQuery = defineTool({
    name: "graph_search_rest_query",
    description:
      "Unified Microsoft 365 search across mail, files, sites, and people.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string." },
        entity_types: {
          type: "array",
          items: { type: "string" },
          description:
            "message, driveItem, site, person, list, listItem (default: message, driveItem, site, person).",
        },
        from: { type: "number", description: "Result offset." },
        size: { type: "number", description: "Page size (default 25)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      if (!graphSearchRestEnabled()) return graphErrorResult("Graph search REST is off.");
      const q = String(args["query"] ?? "").trim();
      const types = Array.isArray(args["entity_types"])
        ? (args["entity_types"] as unknown[]).map(String)
        : ["message", "driveItem", "site", "person"];
      const from = args["from"] != null ? Number(args["from"]) : 0;
      const size = args["size"] != null ? Number(args["size"]) : 25;
      const payload = {
        requests: [
          {
            entityTypes: types,
            query: { queryString: q },
            from,
            size,
          },
        ],
      };
      const result = await graphApiJson("/search/query", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [searchQuery];
}
