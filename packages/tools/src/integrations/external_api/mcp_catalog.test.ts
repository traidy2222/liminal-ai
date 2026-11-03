import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "@liminal/core";
import { assignMcpToolNames, mcpHandshakeAndListTools, registerMcpConnection } from "./mcp_attach.js";

test("HTTP catalogs keep every page, full schemas, descriptions, annotations and structured results", async () => {
  const original = globalThis.fetch;
  const description = "Full server contract. ".repeat(60);
  const schema = { type: "object", properties: { payload: { $ref: "#/$defs/Payload" } }, $defs: { Payload: { type: "string" } } };
  const cursors: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpc.method === "initialize") return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18" } });
      if (rpc.method === "tools/call") return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [], structuredContent: { evidence_id: "http-fixture" } } });
      cursors.push(rpc.params?.cursor);
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.params?.cursor
        ? { tools: [{ name: "apply_operation", description, inputSchema: schema, annotations: { readOnlyHint: false } }] }
        : { tools: [{ name: "inspect_fixture", description, inputSchema: schema, outputSchema: { type: "object" }, annotations: { readOnlyHint: true } }], nextCursor: "second" } });
    };
    const discovered = await mcpHandshakeAndListTools("http://127.0.0.1/fixture", { kind: "none" });
    assert.deepEqual(cursors, [undefined, "second"]);
    assert.equal(discovered.tools.length, 2);
    assert.equal(discovered.tools[0]!.description, description);
    assert.deepEqual(discovered.tools[0]!.outputSchema, { type: "object" });
    assignMcpToolNames(discovered.tools, "fixture");
    const registry = new ToolRegistry();
    registerMcpConnection(registry, { kind: "mcp", name: "fixture", transport: "http", serverUrl: "http://127.0.0.1/fixture", auth: { kind: "none" }, attachedAt: 0, tools: discovered.tools });
    assert.deepEqual((registry.get("mcp_fixture_inspect_fixture")!.parameters as unknown as Record<string, unknown>).$defs, schema.$defs);
    assert.equal(registry.get("mcp_fixture_apply_operation")!.requiresApproval, true);
    const result = await registry.get("mcp_fixture_inspect_fixture")!.handler({ payload: "fixture" });
    assert(result.ok);
    assert.deepEqual(JSON.parse(result.output), { evidence_id: "http-fixture" });
  } finally { globalThis.fetch = original; }
});

test("HTTP tool discovery rejects a repeated pagination cursor", async () => {
  const original = globalThis.fetch;
  let pages = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpc.method === "initialize") return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {} });
      pages++;
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [], nextCursor: "same" } });
    };
    await assert.rejects(mcpHandshakeAndListTools("http://127.0.0.1/fixture", { kind: "none" }), /repeated.*cursor/);
    assert.equal(pages, 2);
  } finally { globalThis.fetch = original; }
});
