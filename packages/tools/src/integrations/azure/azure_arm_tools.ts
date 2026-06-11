/**
 * Curated Azure Resource Manager REST tools.
 * @see https://learn.microsoft.com/en-us/rest/api/resources/
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  ARM_API_VERSION,
  parseArmResourceId,
  pickArmApiVersion,
} from "./azure_arm_api.js";
import {
  azureApiFetch,
  azureApiJson,
  azureErrorResult,
  azureJsonResult,
  azureRestEnabled,
} from "./azure_rest.js";

async function resolveProviderApiVersion(
  subscriptionId: string,
  providerNamespace: string
): Promise<string | undefined> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/${encodeURIComponent(providerNamespace)}?api-version=${ARM_API_VERSION.providers}`;
  const result = await azureApiJson<{
    resourceTypes?: Array<{ apiVersions?: string[] }>;
  }>(path);
  if (!result.ok) return undefined;
  const all: string[] = [];
  for (const rt of result.data.resourceTypes ?? []) {
    if (rt.apiVersions) all.push(...rt.apiVersions);
  }
  return pickArmApiVersion(all);
}

export function createAzureArmRestTools(): ToolDefinition[] {
  const checkAuth = defineTool({
    name: "azure_check_auth",
    description:
      "Verify Azure ARM credentials (OAuth or az login) by listing subscriptions.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const result = await azureApiJson<{ value?: unknown[] }>("/subscriptions");
      if (!result.ok) return azureErrorResult(result.error);
      const count = result.data.value?.length ?? 0;
      return azureJsonResult({ ok: true, subscriptionCount: count });
    },
  });

  const listSubscriptions = defineTool({
    name: "azure_list_subscriptions",
    description: "List Azure subscriptions accessible to the signed-in principal.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const result = await azureApiJson<{ value?: unknown[] }>("/subscriptions");
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const getSubscription = defineTool({
    name: "azure_get_subscription",
    description: "Get details for one Azure subscription.",
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
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const result = await azureApiJson(
        `/subscriptions/${encodeURIComponent(sub)}`
      );
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const listLocations = defineTool({
    name: "azure_list_locations",
    description: "List Azure regions available in a subscription.",
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
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const result = await azureApiJson(
        `/subscriptions/${encodeURIComponent(sub)}/locations`
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
        `/subscriptions/${encodeURIComponent(sub)}/resourcegroups`
      );
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const createResourceGroup = defineTool({
    name: "azure_create_resource_group",
    description: "Create or update a resource group in a subscription.",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        resource_group: { type: "string", description: "Resource group name." },
        location: { type: "string", description: "Azure region, e.g. eastus." },
        tags: { type: "object", description: "Optional tags object." },
      },
      required: ["subscription_id", "resource_group", "location"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const rg = String(args["resource_group"] ?? "").trim();
      const location = String(args["location"] ?? "").trim();
      const tags = args["tags"];
      const body: Record<string, unknown> = { location };
      if (tags != null && typeof tags === "object") body.tags = tags;
      const path = `/subscriptions/${encodeURIComponent(sub)}/resourcegroups/${encodeURIComponent(rg)}`;
      const result = await azureApiJson(path, {
        method: "PUT",
        body: JSON.stringify(body),
        apiVersion: ARM_API_VERSION.resourceGroups,
      });
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const deleteResourceGroup = defineTool({
    name: "azure_delete_resource_group",
    description: "Delete a resource group and all contained resources.",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        resource_group: { type: "string" },
      },
      required: ["subscription_id", "resource_group"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const rg = String(args["resource_group"] ?? "").trim();
      const path = `/subscriptions/${encodeURIComponent(sub)}/resourcegroups/${encodeURIComponent(rg)}`;
      const res = await azureApiFetch(path, {
        method: "DELETE",
        apiVersion: ARM_API_VERSION.resourceGroups,
      });
      if (res.status === 202 || res.status === 204) {
        return azureJsonResult({ deleted: true, status: res.status });
      }
      const text = await res.text();
      return azureErrorResult(`Azure ARM HTTP ${res.status}: ${text.slice(0, 800)}`);
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
      const params = new URLSearchParams();
      if (filter) params.set("$filter", filter);
      if (Number.isFinite(top) && top > 0) params.set("$top", String(top));
      const base = rg
        ? `/subscriptions/${encodeURIComponent(sub)}/resourceGroups/${encodeURIComponent(rg)}/resources`
        : `/subscriptions/${encodeURIComponent(sub)}/resources`;
      const qs = params.toString();
      const path = qs ? `${base}?${qs}` : base;
      const result = await azureApiJson(path);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const listResourceProviders = defineTool({
    name: "azure_list_resource_providers",
    description: "List resource providers registered in a subscription.",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        expand: {
          type: "string",
          enum: ["resourceTypes", "metadata"],
          description: "Optional $expand value.",
        },
      },
      required: ["subscription_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const expand = String(args["expand"] ?? "").trim();
      const params = new URLSearchParams();
      if (expand) params.set("$expand", expand);
      const base = `/subscriptions/${encodeURIComponent(sub)}/providers`;
      const qs = params.toString();
      const path = qs ? `${base}?${qs}` : base;
      const result = await azureApiJson(path);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const getProviderApiVersions = defineTool({
    name: "azure_get_provider_api_versions",
    description:
      "Get supported api-versions for a resource provider namespace (e.g. Microsoft.Compute).",
    parameters: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        provider_namespace: {
          type: "string",
          description: "Provider namespace, e.g. Microsoft.Compute.",
        },
        resource_type: {
          type: "string",
          description: "Optional child type (e.g. virtualMachines). Returns versions for that type only.",
        },
      },
      required: ["subscription_id", "provider_namespace"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (args): Promise<ToolResult> => {
      if (!azureRestEnabled()) return azureErrorResult("Azure REST is off.");
      const sub = String(args["subscription_id"] ?? "").trim();
      const ns = String(args["provider_namespace"] ?? "").trim();
      const rt = String(args["resource_type"] ?? "").trim();
      const path = `/subscriptions/${encodeURIComponent(sub)}/providers/${encodeURIComponent(ns)}`;
      const result = await azureApiJson<{
        namespace?: string;
        resourceTypes?: Array<{ resourceType?: string; apiVersions?: string[] }>;
      }>(path);
      if (!result.ok) return azureErrorResult(result.error);
      if (!rt) return azureJsonResult(result.data);
      const match = (result.data.resourceTypes ?? []).find(
        (t) => t.resourceType?.toLowerCase() === rt.toLowerCase()
      );
      if (!match) {
        return azureErrorResult(`Resource type ${rt} not found on provider ${ns}.`);
      }
      return azureJsonResult({
        namespace: result.data.namespace ?? ns,
        resourceType: match.resourceType,
        apiVersions: match.apiVersions ?? [],
        recommended: pickArmApiVersion(match.apiVersions ?? []),
      });
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
        const parsed = parseArmResourceId(id);
        if (parsed.subscriptionId && parsed.providerNamespace) {
          const resolved = await resolveProviderApiVersion(
            parsed.subscriptionId,
            parsed.providerNamespace
          );
          apiVersion = resolved ?? ARM_API_VERSION.resources;
        } else {
          apiVersion = ARM_API_VERSION.resources;
        }
      }
      const result = await azureApiJson(id, { apiVersion });
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  const restCall = defineTool({
    name: "azure_rest_call",
    description:
      "Generic Azure Resource Manager REST call. Path is relative to management.azure.com (api-version auto-added when missing).",
    parameters: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method.",
        },
        path: {
          type: "string",
          description: "ARM path, e.g. /subscriptions or /subscriptions/{id}/resourcegroups.",
        },
        api_version: { type: "string", description: "Optional api-version override." },
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
      const apiVersion = String(args["api_version"] ?? "").trim() || undefined;
      const body = args["body"];
      const init: RequestInit & { apiVersion?: string } = { method, apiVersion };
      if (body != null && method !== "GET" && method !== "DELETE") {
        init.body = JSON.stringify(body);
      }
      const result = await azureApiJson(path, init);
      if (!result.ok) return azureErrorResult(result.error);
      return azureJsonResult(result.data);
    },
  });

  return [
    checkAuth,
    listSubscriptions,
    getSubscription,
    listLocations,
    listResourceGroups,
    createResourceGroup,
    deleteResourceGroup,
    listResources,
    listResourceProviders,
    getProviderApiVersions,
    getResource,
    restCall,
  ];
}
