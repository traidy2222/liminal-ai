import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentEmitter, ToolDispatcher, ToolRegistry } from "@liminal/core";
import { attachStdioMcpConnection, createMcpAttachTools, registerMcpConnection } from "./mcp_attach.js";
import { closeStdioMcp } from "./mcp_stdio.js";
import { renderMcpResult } from "./mcp_result.js";
import { listIntegrationConnections } from "../core/integrations_server.js";

test("native stdio MCP preserves the complete catalog, schemas, isolation, permissions and cancellation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-stdio-mcp-"));
  const previousRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  const previousYolo = process.env.AGENT_YOLO;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = path.join(root, "data");
  process.env.AGENT_YOLO = "0";
  const script = path.join(root, "fixture.cjs");
  const marker = path.join(root, "write-marker.txt");
  await fs.writeFile(script, `
const readline=require('node:readline'),fs=require('node:fs');let count=0,writes=0,cancelled=false;
const tools=[
 {name:'read_counter',description:'Read session state.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'echo_schema',description:'Return supplied arguments.',inputSchema:{type:'object',properties:{payload:{$ref:'#/$defs/Payload'}},$defs:{Payload:{type:'object',properties:{value:{type:'integer'}},required:['value']}},required:['payload'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'apply_annotations',description:'Annotation operation.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false}},
 {name:'slow_operation',description:'Read slowly.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'crash_after_write',description:'Write once then disconnect.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false}}
];
function send(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');}
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);
 if(r.method==='notifications/cancelled'){cancelled=true;return;}
 if(r.id===undefined)return;
 if(r.method==='initialize')return send(r.id,{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
 if(r.method==='tools/list')return send(r.id,r.params?.cursor?{tools:tools.slice(2)}:{tools:tools.slice(0,2),nextCursor:'second'});
 if(r.method==='tools/call'){
  if(r.params.name==='slow_operation')return;
  if(r.params.name==='crash_after_write'){fs.appendFileSync(${JSON.stringify(marker)},'once\\n');process.exit(0);}
  if(r.params.name==='apply_annotations')writes++;
  const result=r.params.name==='echo_schema'?{arguments:r.params.arguments}:{count:++count,writes,cancelled,pid:process.pid,cwd:process.cwd()};
  return send(r.id,{content:[],structuredContent:result});
 }
});
process.stdin.on('end',()=>process.exit(0));
`);
  const registry = new ToolRegistry();
  registry.setLazyToolLoading(true);
  const emitter = new AgentEmitter();
  for (const tool of Object.values(createMcpAttachTools(registry, emitter))) registry.register(tool);
  let approvals = 0;
  emitter.on("tool_approval", event => { approvals++; event.resolve({ decision: "reject" }); });
  const dispatcher = new ToolDispatcher(registry, emitter);
  const second = new ToolDispatcher(registry, emitter);
  try {
    const attached = await attachStdioMcpConnection(registry, { name: "fixture", stdio: { command: process.execPath, args: [script] } });
    assert.equal(attached.record.tools.length, 5, "all tools/list pages survive discovery");
    const summary = (await listIntegrationConnections()).find(c => c.name === "fixture")!;
    assert.equal(summary.transport, "stdio");
    assert.equal(summary.toolCount, 5);
    assert.equal(summary.serverUrl, undefined);
    assert.deepEqual((registry.get("mcp_fixture_echo_schema")!.parameters as unknown as Record<string, unknown>).$defs, { Payload: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] } });
    assert.equal(registry.get("mcp_fixture_apply_annotations")!.requiresApproval, true);
    assert.equal(registry.get("mcp_fixture_read_counter")!.cacheable, false);
    const search = await dispatcher.dispatch("search", "mcp_search_tools", JSON.stringify({ connection: "fixture", query: "read_counter", limit: 1 }));
    assert(search.ok);
    assert.equal(JSON.parse(search.output).availableTools, 5);
    assert.equal(registry.getActiveToolNames().filter(n => n.startsWith("mcp_fixture_")).length, 1);
    async function read(owner: ToolDispatcher) {
      const result = await owner.dispatch(crypto.randomUUID(), "mcp_fixture_read_counter", "{}");
      assert(result.ok, result.ok ? undefined : result.error);
      return JSON.parse(result.output);
    }
    const first = await read(dispatcher);
    assert.equal(first.count, 1);
    assert.ok(first.cwd.startsWith(path.join(root, "data", "sidecars", "mcp")));
    assert.equal((await read(dispatcher)).count, 2);
    assert.equal((await read(second)).count, 1, "another dispatcher gets an independent target/session");
    await closeStdioMcp("fixture", second);
    assert.equal((await read(second)).count, 1, "disposing one conversation releases only its own process");
    const echoed = await dispatcher.dispatch("echo", "mcp_fixture_echo_schema", '{"payload":{"value":7}}');
    assert(echoed.ok);
    assert.deepEqual(JSON.parse(echoed.output), { arguments: { payload: { value: 7 } } });
    const denied = await dispatcher.dispatch("denied", "mcp_fixture_apply_annotations", "{}");
    assert.equal(denied.ok, false);
    assert.equal(approvals, 1);
    assert.equal((await read(dispatcher)).writes, 0, "denied writes never reach the server");
    const readOnly = new ToolRegistry();
    registerMcpConnection(readOnly, { ...attached.record, readOnly: true });
    assert.equal(readOnly.has("mcp_fixture_apply_annotations"), false);
    const abort = new AbortController();
    dispatcher.setTurnAbortSignal(abort.signal);
    const slow = dispatcher.dispatch("slow", "mcp_fixture_slow_operation", "{}");
    setTimeout(() => abort.abort(), 100);
    assert.equal((await slow).ok, false, "stopping a turn cancels an outstanding MCP request");
    dispatcher.setTurnAbortSignal(undefined);
    assert.equal((await read(dispatcher)).cancelled, true);
    const crashEmitter = new AgentEmitter();
    crashEmitter.on("tool_approval", event => event.resolve({ decision: "approve" }));
    const crashOwner = new ToolDispatcher(registry, crashEmitter);
    assert.equal((await crashOwner.dispatch("crash", "mcp_fixture_crash_after_write", "{}")).ok, false);
    assert.equal(await fs.readFile(marker, "utf8"), "once\n", "transport failure never automatically replays a write");
    const image = Buffer.from("fixture image bytes");
    const rendered = await renderMcpResult({ content: [{ type: "image", data: image.toString("base64"), mimeType: "image/png" }], structuredContent: { evidence_id: "fixture-evidence" } }, "fixture");
    const [media, evidence] = rendered.split("\n").map(s => JSON.parse(s));
    assert.deepEqual(await fs.readFile(media.path), image);
    assert.equal(evidence.evidence_id, "fixture-evidence");
  } finally {
    await closeStdioMcp();
    if (previousRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT; else process.env.AGENT_GLOBAL_STORAGE_ROOT = previousRoot;
    if (previousYolo === undefined) delete process.env.AGENT_YOLO; else process.env.AGENT_YOLO = previousYolo;
    await fs.rm(root, { recursive: true, force: true });
  }
});
