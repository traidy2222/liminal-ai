import assert from "node:assert/strict";
import { test } from "node:test";
import { expandMcpToolProperties } from "./mcp_schema_normalize.js";
import { cleanMcpCallArgs } from "./google_mcp_tool_args.js";
import { prepareToolArgsForValidation } from "./tool_dispatch_args.js";
import type { PropertySchema } from "./types.js";

function prepare(properties: Record<string, PropertySchema>, args: Record<string, unknown>) {
  const result = prepareToolArgsForValidation("mcp_google_gmail_create_label", args, {
    type: "object", properties: expandMcpToolProperties(properties),
    required: Object.keys(properties), additionalProperties: false,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw Error(result.error);
  return cleanMcpCallArgs(result.args, properties);
}

test("Gmail's required displayName survives registration, validation and remote serialization", () => {
  assert.deepEqual(prepare({ displayName: { type: "string" } }, { displayName: "Project updates" }), {
    displayName: "Project updates",
  });
});

test("MCP definitions expose the server fields without duplicating their descriptions as aliases", () => {
  const properties = expandMcpToolProperties({ query: { type: "string", description: "Search syntax" }, pageSize: { type: "integer" } });
  assert.deepEqual(Object.keys(properties), ["query", "pageSize"]);
  const result = prepareToolArgsForValidation("mcp_google_gmail_search_threads", { q: "in:inbox", page_size: "5" }, {
    type: "object", properties, additionalProperties: false,
  });
  assert.deepEqual(result, { ok: true, args: { query: "in:inbox", pageSize: 5 } });
});

test("declared query and text fields retain independent values", () => {
  assert.deepEqual(prepare({ query: { type: "string" }, text: { type: "string" } }, { query: "search", text: "replacement" }), {
    query: "search", text: "replacement",
  });
});

test("resource names and display names are not interchangeable", () => {
  assert.deepEqual(prepare({ name: { type: "string" }, displayName: { type: "string" } }, { name: "labels/resource-id", displayName: "Inbox work" }), {
    name: "labels/resource-id", displayName: "Inbox work",
  });
});

test("native snake_case fields remain valid remote fields", () => {
  assert.deepEqual(prepare({ page_size: { type: "integer" }, text: { type: "string" } }, { page_size: "3", text: "Content" }), {
    page_size: 3, text: "Content",
  });
});

test("MCP numeric fields retain fractions while integer fields retain their type", () => {
  const properties = { position: { type: "number" }, pageSize: { type: "integer" } };
  assert.equal(expandMcpToolProperties(properties).pageSize.type, "integer");
  assert.deepEqual(prepare(properties, { position: 0.75, pageSize: "3" }), { position: 0.75, pageSize: 3 });
});
