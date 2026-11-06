import test from "node:test";
import assert from "node:assert/strict";
import { browserFirstSuppressedTools } from "./browser_first_policy.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

test("ordinary web, stock and weather research cannot substitute direct lookup tools", () => {
  for (const message of ["Research promising stocks", "Find NVIDIA's current stock price", "Get Brisbane's weather", "It is just doing HTTP requests instead of using the browser", "Don't use http_request; use the browser"]) {
    const hidden = browserFirstSuppressedTools(message, false);
    for (const name of ["http_request", "markets_quote", "weather_lookup", "web_search", "web_fetch"]) assert.ok(hidden.includes(name), message);
  }
  assert.ok(!browserFirstSuppressedTools("Call the JSON API at https://example.com/data", false).includes("http_request"));
  assert.ok(!browserFirstSuppressedTools("Please use markets_quote for NVDA", false).includes("markets_quote"));
  assert.ok(browserFirstSuppressedTools("Please use markets_quote for NVDA", false).includes("http_request"));
  assert.deepEqual(browserFirstSuppressedTools("Research stocks", true), []);
});

test("suppression covers discovery, cached activations, schemas and dispatch lookup, and is reversible", () => {
  const registry = new ToolRegistry();
  const tools = ["http_request", "markets_quote", "browser_open"];
  for (const name of tools) registry.register({ name, description: name, parameters: { type: "object", properties: {} }, requiresApproval: false,
    handler: async () => ({ ok: true, output: "ok" }) } as ToolDefinition);
  registry.setToolFamilyLookup(new Map([["http_request", "web"], ["markets_quote", "markets"], ["browser_open", "browser"]]));
  registry.setLazyToolLoading(true); registry.activate(tools);
  registry.setSuppressedTools(browserFirstSuppressedTools("Research stocks", false));
  registry.activateFamilies(["web", "markets"]); registry.activate(["http_request", "markets_quote"]);
  assert.deepEqual(registry.getToolNames(), ["browser_open"]);
  assert.deepEqual(registry.getActiveToolNames(), ["browser_open"]);
  assert.equal(registry.get("http_request"), undefined);
  assert.equal(registry.toOpenAIFormat().length, 1);
  assert.deepEqual(registry.getActiveFamilySummary().map(f => f.family), ["browser"]);
  const child = new ToolRegistry(); for (const name of tools) child.register({ name } as ToolDefinition);
  child.copyLazyPolicyFromParent(registry); assert.equal(child.has("http_request"), false);
  registry.setSuppressedTools(browserFirstSuppressedTools("Use http_request for this API", false));
  assert.ok(registry.has("http_request")); assert.ok(registry.isActive("http_request"));
  assert.equal(registry.has("markets_quote"), false);
  registry.setSuppressedTools(browserFirstSuppressedTools("Now research stocks", false));
  registry.setLazyToolLoading(false);
  assert.equal(registry.getAll().length, 1); assert.equal(registry.toOpenAIFormat().length, 1);
});
