/**
 * Curated Azure Resource Manager REST tools.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  azureApiJson,
  azureErrorResult,
  azureJsonResult,
  azureRestEnabled,
} from "./azure_rest.js";

const API_VERSION_DEFAULT = "2024-03-01";

export function createAzureArmRestTools(): ToolDefinition[] {
  const listSubscriptions = defineTool({
    name: "azure_list_subscriptions",
    description: "List Azure subscriptions accessible to the signed-in principal.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const result = await azureApiJson<{ value?: unknown[] }>(
        `/subscriptions?api-version=${API_VERSION_DEFAULT}`
      );
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const listResourceGroups = defineTool({
    name: "azure_list_resource_groups",
    description: "List resource groups in a subscription.",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "Azure subscription GUID." },
      },
      required: ["subscription_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 20_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const result = await azureApiJson(
        `/subscriptions/${encodeURIComponent(sub)}/resourcegroups?api-version=${API_VERSION_DEFAULT}`
      );
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const listResources = defineTool({
    name: "azure_list_resources",
    description: "List resources in a subscription (optional resource group filter).",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        resource_group: { type: "string", description: "Optional resource group name." },
        filter: { type: "string", description: "Optional OData $filter." },
        top: { type: "number", description: "Max results (default 50)." },
      },
      required: ["subscription_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const rg = String(args["resource_group"] ?? "").trim();
      const filter = String(args["filter"] ?? "").trim();
      const top = args["top"] != null ? Number(args["top"]) : 50;
      const params = new URLSearchParams({ "api-version": API_VERSION_DEFAULT });
      if (filter) params.set("$filter", filter);
      if (Number.isFinite(top) && top > 0) params.set("$top", String(top));
      const base = rg
        ? `/subscriptions/${encodeURIComponent(sub)}/resourceGroups/${encodeURIComponent(rg)}/resources`
        : `/subscriptions/${encodeURIComponent(sub)}/resources`;
      const result = await azureApiJson(`${base}?${params.toString()}`);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const getResource = defineTool({
    name: "azure_get_resource",
    description: "Get a single Azure resource by ARM resource ID.",
    parameters: {
      type: "object",
      properties: {
        resource_id: {
          type: "string",
          description: "Full ARM ID, e.g. /subscriptions/.../resourceGroups/.../providers/.../...",
        },
        api_version: { type: "string", description: "Provider API version (auto-detected if omitted)." },
      },
      required: ["resource_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      let id = String(args["resource_id"] ?? "").trim();
      if (!id.startsWith("/")) id = `/${id}`;
      let apiVersion = String(args["api_version"] ?? "").trim();
      if (!apiVersion) {
        const providerMatch = id.match(/\/providers\/([^/]+\/[^/]+)/i);
        apiVersion = providerMatch ? "2023-01-01" : API_VERSION_DEFAULT;
      }
      const result = await azureApiJson(`${id}?api-version=${encodeURIComponent(apiVersion)}`);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const restCall = defineTool({
    name: "azure_rest_call",
    description:
      "Generic Azure Resource Manager REST call. Path is relative to management.azure.com or absolute URL.",
    parameters: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method.",
        },
        path: { type: "string", description: "ARM path including query string." },
        body: { type: "object", description: "JSON body for write methods." },
      },
      required: ["method", "path"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const method = String(args["method"] ?? "GET").toUpperCase();
      const path = String(args["path"] ?? "").trim();
      const body = args["body"];
      const init: RequestInit = { method };
      if (body != null && method !== "GET" && method !== "DELETE") {
        init.body = JSON.stringify(body);
      }
      const result = await azureApiJson(path, init);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  return [listSubscriptions, listResourceGroups, listResources, getResource, restCall];
}
