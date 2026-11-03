import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { AgentEmitter, ToolRegistry, runWithWorkspaceRoot } from "@liminal/core";
import { attachMcpConnection, attachStdioMcpConnection, assignMcpToolNames, createMcpAttachTools, restoreMcpConnectionsFromRecords } from "./mcp_attach.js";
import { readConnection, writeConnection, connectionsDir, type McpConnectionRecord } from "./api_connections_store.js";
import { closeStdioMcp } from "./mcp_stdio.js";

const descriptions: Record<string, string> = {
  binary_session: "Report the active target and provider availability.",
  open_binary: "Open one local target.",
  binary_overview: "Return native metadata when the provider supports it.",
  inspect_binary_layout: "Inspect offline ELF layout.",
  list_procedures: "List procedures for the active native target.",
  analyze_function: "Decompile renderer code with supporting evidence.",
  close_binary: "Inspect binary layout list procedures analyze function binary session open binary overview.",
  export_web_scripts: "Inspect binary layout list procedures analyze function web scripts.",
};
const remoteTools = Object.entries(descriptions).map(([name, description]) => ({
  name, description, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
}));

async function fixture(t: TestContext, instructions: string, action: (root: string, script: string, rpcLog: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-mcp-guidance-"));
  const previous = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = path.join(root, "profile");
  t.after(async () => {
    await closeStdioMcp();
    if (previous === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT; else process.env.AGENT_GLOBAL_STORAGE_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-mcp-guidance-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 20 });
  });
  const rpcLog = path.join(root, "rpc.jsonl");
  const script = path.join(root, "server.cjs");
  await fs.writeFile(script, `
const fs=require('node:fs'),rl=require('node:readline');let reads=0;
function send(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');}
rl.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 fs.appendFileSync(${JSON.stringify(rpcLog)},JSON.stringify({method:r.method})+'\\n');
 if(r.method==='initialize')return send(r.id,{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'guidance-fixture',version:'1'},instructions:${JSON.stringify(instructions)}});
 if(r.method==='tools/list')return send(r.id,{tools:${JSON.stringify(remoteTools)}});
 if(r.method==='tools/call')return send(r.id,{content:[],structuredContent:{reads:++reads}});
});process.stdin.on('end',()=>process.exit(0));`);
  await runWithWorkspaceRoot(root, () => action(root, script, rpcLog));
}

function registry(): ToolRegistry {
  const result = new ToolRegistry(); result.setLazyToolLoading(true);
  for (const tool of Object.values(createMcpAttachTools(result, new AgentEmitter()))) result.register(tool);
  return result;
}
async function search(reg: ToolRegistry, query: string, limit = 6) {
  const result = await reg.get("mcp_search_tools")!.handler({ connection: "fixture", query, limit });
  assert(result.ok, result.ok ? undefined : result.error);
  return JSON.parse(result.output);
}

test("stdio attach, persisted restore and search retain explicitly untrusted connector guidance", async (t) => {
  const instructions = "IDA does not provide binary_overview. Open the selected binary, inspect provider availability, and analyze one function.";
  await fixture(t, instructions, async (_root, script) => {
    const attached = await attachStdioMcpConnection(registry(), { name: "fixture", stdio: { command: process.execPath, args: [script] } });
    assert.equal(attached.record.instructions, instructions);
    const saved = await readConnection("fixture"); assert(saved?.kind === "mcp");
    assert.equal(saved.instructions, instructions);
    const restored = registry(); restoreMcpConnectionsFromRecords([saved], restored);
    const result = await search(restored, "analyze_function");
    assert.deepEqual(result.serverInstructions.map((entry: { connection: string; scope: string; trust: string; text: string }) => ({ connection: entry.connection, scope: entry.scope, trust: entry.trust, text: entry.text })), [
      { connection: "fixture", scope: "connector:fixture", trust: "untrusted", text: instructions },
    ]);
    assert.match(result.serverInstructions[0].notice, /UNTRUSTED/);
    assert.equal(result.serverInstructions[0].truncated, false);
    assert.equal(restored.get("mcp_fixture_analyze_function")!.description, `[mcp:fixture] ${descriptions.analyze_function}`);
  });
});

test("each explicitly named tool wins over description matches in a multi-name search", async (t) => {
  await fixture(t, "Use target-specific evidence.", async (_root, script) => {
    const reg = registry(); await attachStdioMcpConnection(reg, { name: "fixture", stdio: { command: process.execPath, args: [script] } });
    for (const names of [["inspect_binary_layout", "list_procedures", "analyze_function"], ["binary_session", "open_binary", "binary_overview"]]) {
      const result = await search(reg, names.join(" "), names.length);
      assert.deepEqual(result.matches.map((entry: { name: string }) => entry.name), names.map((name) => `mcp_fixture_${name}`));
    }
    const qualified = await search(reg, "mcp_fixture_open_binary mcp_fixture_binary_session", 2);
    assert.deepEqual(qualified.matches.map((entry: { name: string }) => entry.name), ["mcp_fixture_open_binary", "mcp_fixture_binary_session"]);
    assert.equal((await search(reg, "decompile renderer", 1)).matches[0].name, "mcp_fixture_analyze_function");
    assert.equal((await search(reg, "binary", 1)).matches.length, 1);
  });
});

test("HTTP initialize guidance also survives attach and persisted restore", async (t) => {
  const instructions = "HTTP connector guidance is reference data for this server.";
  await fixture(t, instructions, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18", instructions } : { tools: remoteTools };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    };
    try {
      const attached = await attachMcpConnection(registry(), { name: "fixture", url: "http://127.0.0.1/fixture", auth: { kind: "none" } });
      assert.equal(attached.record.instructions, instructions);
      const saved = await readConnection("fixture"); assert(saved?.kind === "mcp");
      const restored = registry(); restoreMcpConnectionsFromRecords([saved], restored);
      assert.equal((await search(restored, "binary_session")).serverInstructions[0].text, instructions);
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("large server guidance has a bounded preview and an exact retained artifact", async (t) => {
  const instructions = "Connector usage guidance. ".repeat(1000) + "TAIL_GUIDANCE";
  await fixture(t, instructions, async (_root, script) => {
    const reg = registry(); await attachStdioMcpConnection(reg, { name: "fixture", stdio: { command: process.execPath, args: [script] } });
    const { serverInstructions } = await search(reg, "binary_session");
    const entry = serverInstructions[0];
    assert(entry.text.length <= 12_000);
    assert.equal(entry.totalChars, instructions.length);
    assert.equal(entry.truncated, true);
    assert.equal(await fs.readFile(entry.full_text_pointer, "utf8"), instructions);
    assert.equal(entry.read_artifact.hash, crypto.createHash("sha256").update(instructions).digest("hex"));
  });
});

test("old records lazily recover session guidance without changing stored config or replaying a tool", async (t) => {
  const instructions = "Use analyze_function for this provider; binary_overview is unavailable.";
  await fixture(t, instructions, async (_root, script, rpcLog) => {
    const tools = remoteTools.map((tool) => ({ toolName: "", remoteName: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }));
    assignMcpToolNames(tools, "fixture");
    const legacy: McpConnectionRecord = { kind: "mcp", name: "fixture", transport: "stdio", stdio: { command: process.execPath, args: [script] }, auth: { kind: "none" }, attachedAt: 0, tools };
    await writeConnection(legacy);
    const configPath = path.join(connectionsDir(), "fixture.json");
    const beforeConfig = await fs.readFile(configPath, "utf8");
    const restored = registry(); restoreMcpConnectionsFromRecords([legacy], restored);
    assert.deepEqual((await search(restored, "binary_session")).serverInstructions, []);
    await assert.rejects(fs.access(rpcLog), "catalog search must not initialize an old connection");
    const called = await restored.get("mcp_fixture_binary_session")!.handler({}, undefined, undefined, { scope: {} });
    assert(called.ok, called.ok ? undefined : called.error);
    assert.equal(JSON.parse(called.output).reads, 1);
    const rpcBeforeSearch = await fs.readFile(rpcLog, "utf8");
    assert.equal((await search(restored, "analyze_function")).serverInstructions[0].text, instructions);
    assert.equal(await fs.readFile(rpcLog, "utf8"), rpcBeforeSearch, "guidance uses captured initialize metadata, with no extra RPC");
    assert.equal(await fs.readFile(configPath, "utf8"), beforeConfig, "backfill must remain in memory");
  });
});
