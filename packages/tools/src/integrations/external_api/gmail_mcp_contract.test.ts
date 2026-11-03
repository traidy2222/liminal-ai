import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentEmitter, ToolDispatcher, ToolRegistry, prepareToolArgsForValidation } from "@liminal/core";
import type { McpConnectionRecord, McpToolRecord } from "./api_connections_store.js";
import { registerMcpConnection } from "./mcp_attach.js";

function connection(remoteName: string, properties: Record<string, unknown>, required: string[] = [], connectionName = "google_gmail"): McpConnectionRecord {
  return {
    kind: "mcp", name: connectionName, serverUrl: "https://gmailmcp.googleapis.com/mcp/v1",
    transport: "http", auth: { kind: "none" }, attachedAt: 0, parentProvider: "google_workspace",
    tools: [{ toolName: `mcp_${connectionName}_${remoteName}`, remoteName, description: remoteName,
      inputSchema: { type: "object", properties, required } } satisfies McpToolRecord],
  };
}

test("registered Gmail label requests reach MCP with Google's required displayName intact", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://gmailmcp.googleapis.com/mcp/v1");
      const rpc = JSON.parse(String(init?.body));
      assert.equal(rpc.method, "tools/call");
      assert.equal(rpc.params.name, "create_label");
      assert.deepEqual(rpc.params.arguments, { displayName: "Project updates" });
      calls++;
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: '{"id":"fixture-label"}' }] } });
    };
    const registry = new ToolRegistry();
    registerMcpConnection(registry, connection("create_label", { displayName: { type: "string" } }, ["displayName"]));
    const tool = registry.get("mcp_google_gmail_create_label")!;
    assert.equal(tool.requiresApproval, true);
    const prepared = prepareToolArgsForValidation(tool.name, { displayName: "Project updates" }, tool.parameters);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw Error(prepared.error);
    assert.equal((await tool.handler(prepared.args)).ok, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("Gmail MCP camelCase reply IDs allow normal plain-text replies", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      assert.equal(rpc.params.arguments.replyToMessageId, "fixture-message");
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: '{"id":"fixture-draft"}' }] } });
    };
    const registry = new ToolRegistry();
    registerMcpConnection(registry, connection("create_draft", { body: { type: "string" }, htmlBody: { type: "string" }, replyToMessageId: { type: "string" } }));
    const tool = registry.get("mcp_google_gmail_create_draft")!;
    assert.equal(tool.requiresApproval, true);
    assert.match(tool.description, /htmlBody/);
    assert.doesNotMatch(tool.description, /plain.only/i);
    const result = await tool.handler({ replyToMessageId: "fixture-message", body: "Thank you for the update.\n\nI have reviewed the information and will follow up with the requested details tomorrow morning." });
    assert.equal(result.ok, true);
  } finally { globalThis.fetch = original; }
});

test("Gmail entity-not-found errors request fresh IDs without leaking backend stack traces", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {
      isError: true, content: [{ type: "text", text: 'Failed to label message: Status 404, Body: {"error":{"message":"Requested entity was not found.","debugInfo":"backend-stack-fixture"}}' }],
    } });
    };
    const registry = new ToolRegistry();
    registerMcpConnection(registry, connection("get_message", { messageId: { type: "string" } }));
    const result = await registry.get("mcp_google_gmail_get_message")!.handler({ messageId: "missing-fixture" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /404/);
    assert.match(result.error ?? "", /exact returned message ID/);
    assert.doesNotMatch(result.error ?? "", /backend-stack/);
  } finally { globalThis.fetch = original; }
});

test("a valid plain-text MCP draft is not rejected for lacking decorative HTML", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      assert.equal(rpc.params.arguments.body.includes("meeting"), true);
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: '{"id":"fixture-plain-draft"}' }] } });
    };
    const registry = new ToolRegistry();
    registerMcpConnection(registry, connection("create_draft", { body: { type: "string" } }));
    const tool = registry.get("mcp_google_gmail_create_draft")!;
    assert.equal(tool.requiresApproval, true);
    assert.equal((await tool.handler({ body: "Hello team,\n\nPlease find the meeting notes below. We will review the outstanding items tomorrow and confirm the next steps together." })).ok, true);
  } finally { globalThis.fetch = original; }
});

test("a label API failure does not incorrectly request message IDs", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {
      isError: true, content: [{ type: "text", text: "Status 404: Requested entity was not found." }],
    } });
    };
    const registry = new ToolRegistry();
    registerMcpConnection(registry, connection("create_label", { displayName: { type: "string" } }));
    const result = await registry.get("mcp_google_gmail_create_label")!.handler({ displayName: "Fixture" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /404/);
    assert.doesNotMatch(result.error ?? "", /message ID|thread ID/);
  } finally { globalThis.fetch = original; }
});

for (const connectionName of ["google_gmail", "mail_team"]) test(`Gmail reads refresh immediately after mailbox changes (${connectionName})`, async () => {
  const original = globalThis.fetch;
  const labels: Array<{ id: string; name: string }> = [];
  let reads = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.params.name === "create_label") labels.push({ id: "fixture-label", name: rpc.params.arguments.displayName });
      else reads++;
      const output = rpc.params.name === "list_labels" ? { labels } : { id: "fixture-label" };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(output) }] } });
    };
    const registry = new ToolRegistry();
    const record = connection("list_labels", {}, [], connectionName);
    record.tools.push(...connection("create_label", { displayName: { type: "string" } }, ["displayName"], connectionName).tools);
    registerMcpConnection(registry, record);
    const emitter = new AgentEmitter();
    emitter.on("tool_approval", event => event.resolve({ decision: event.name === `mcp_${connectionName}_create_label` && event.args.displayName === "Fixture" ? "approve" : "reject" }));
    const dispatcher = new ToolDispatcher(registry, emitter);
    assert.equal((await dispatcher.dispatch("before", `mcp_${connectionName}_list_labels`, "{}")).ok, true);
    assert.equal((await dispatcher.dispatch("write", `mcp_${connectionName}_create_label`, '{"displayName":"Fixture"}')).ok, true);
    const after = await dispatcher.dispatch("after", `mcp_${connectionName}_list_labels`, "{}");
    assert.equal(after.ok, true);
    assert.equal(JSON.parse(after.output!).labels.length, 1);
    assert.equal(reads, 2);
  } finally { globalThis.fetch = original; }
});

test("restoring older read-only Gmail records hides newly recognized write actions", () => {
  const registry = new ToolRegistry();
  const record = connection("list_labels", {});
  record.readOnly = true;
  record.tools.push(...connection("trash_message", { messageId: { type: "string" } }).tools);
  const registered = registerMcpConnection(registry, record);
  assert.deepEqual(registered, ["mcp_google_gmail_list_labels"]);
  assert.equal(registry.has("mcp_google_gmail_trash_message"), false);
});
