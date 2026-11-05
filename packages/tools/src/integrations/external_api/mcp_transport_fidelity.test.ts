import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "@liminal/core";
import { registerMcpConnection } from "./mcp_attach.js";
import { closeStdioMcp } from "./mcp_stdio.js";

async function httpFixture(action: (request: Record<string, any>, response: http.ServerResponse) => void) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls++;
    action(JSON.parse(body), res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const registry = new ToolRegistry();
  registerMcpConnection(registry, {
    kind: "mcp", transport: "http", name: "fidelity", auth: { kind: "none" }, attachedAt: 0,
    serverUrl: `http://127.0.0.1:${address.port}/mcp`, tools: [{
      remoteName: "read", toolName: "mcp_fidelity_read", description: "Read fixture.",
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
    }],
  });
  return {
    handler: registry.get("mcp_fidelity_read")!.handler,
    calls: () => calls,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

test("HTTP SSE skips notifications and unrelated IDs, joins data lines, and finishes before stream closes", async () => {
  const fixture = await httpFixture((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(': heartbeat\n\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"working"}}\n\n');
    res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: req.id + 100, result: { content: [{ type: "text", text: "wrong target" }] } })}\n\n`);
    const result = JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "exact evidence" }] } });
    const split = result.indexOf(',"result"');
    res.write(`data: ${result.slice(0, split + 1)}\r\ndata: ${result.slice(split + 1)}\r\n\r\n`);
    // A valid MCP stream need not end immediately after this response.
    const timer = setTimeout(() => res.end(), 900); res.on("close", () => clearTimeout(timer));
  });
  try {
    const started = Date.now();
    const result = await fixture.handler({});
    assert(result.ok, result.ok ? undefined : result.error);
    assert.equal(result.output, "exact evidence");
    assert(Date.now() - started < 700, "do not wait for EOF after the matched response");
    assert.equal(fixture.calls(), 1);
  } finally { await fixture.close(); }
});

test("HTTP JSON rejects a mismatched response ID instead of accepting another request's evidence", async () => {
  const fixture = await httpFixture((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: req.id + 1, result: { content: [{ type: "text", text: "wrong evidence" }] } }));
  });
  try {
    const result = await fixture.handler({}); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /response.*id|id.*match/i);
    assert.equal(fixture.calls(), 1, "never replay an ambiguously completed request");
  } finally { await fixture.close(); }
});

test("HTTP JSON-RPC errors preserve structured backend diagnostics and retained evidence", async () => {
  const error = { code: -32001, message: "analysis unavailable", data: { reason: "analysis_pending", evidence_id: "ev_fixture", retryable: false } };
  const fixture = await httpFixture((req, res) => {
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: req.id, error }));
  });
  try {
    const result = await fixture.handler({}); assert.equal(result.ok, false);
    if (!result.ok) { assert.match(result.error, /ev_fixture/); assert.match(result.error, /analysis_pending/); }
    assert.equal(fixture.calls(), 1);
  } finally { await fixture.close(); }
});

test("HTTP foreground cancellation aborts the owned request promptly without replay", async () => {
  let sawRequest!: () => void;
  const requestArrived = new Promise<void>(resolve => { sawRequest = resolve; });
  const fixture = await httpFixture((req, res) => {
    sawRequest();
    const timer = setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "late" }] } }));
    }, 900);
    res.on("close", () => clearTimeout(timer));
  });
  const controller = new AbortController();
  try {
    const resultPromise = fixture.handler({}, undefined, undefined, { scope: {}, signal: controller.signal });
    await requestArrived;
    const started = Date.now(); controller.abort();
    const result = await resultPromise;
    assert.equal(result.ok, false); assert(Date.now() - started < 700);
    assert.equal(fixture.calls(), 1);
    const preAborted = await fixture.handler({}, undefined, undefined, { scope: {}, signal: controller.signal });
    assert.equal(preAborted.ok, false); assert.equal(fixture.calls(), 1, "pre-aborted calls must not reach the provider");
  } finally { await fixture.close(); }
});

test("stdio concurrent replies retain correlation, complete Unicode evidence and native error data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-mcp-fidelity-"));
  const previous = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = path.join(root, "profile");
  const scope = {};
  const script = path.join(root, "fixture.cjs");
  await fs.writeFile(script, `
const rl=require('node:readline');let calls=0;const pending=[];
function send(id,fields){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...fields})+'\\n');}
rl.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 if(r.method==='initialize')return send(r.id,{result:{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fidelity',version:'1'}}});
 if(r.method==='tools/list')return send(r.id,{result:{tools:[{name:'read',inputSchema:{type:'object',properties:{}}}]}});
 if(r.method==='tools/call'){
  calls++;const args=r.params.arguments;
  if(args.fail)send(r.id,{error:{code:-32001,message:'analysis pending',data:{reason:'health_not_ready',evidence_id:'ev_stdio_fixture',retryable:false}}});
  else pending.push({id:r.id,args});
  // Wait for all three requests before replying. Pipe delivery need not fit in 1ms.
  if(calls===3)for(const {id,args} of pending)setTimeout(()=>send(id,{result:{content:[],structuredContent:{token:args.token,payload:'🧪Evidence'.repeat(20000),pid:process.pid,calls}}}),args.delay);
 }
});process.stdin.on('end',()=>process.exit(0));`);
  const registry = new ToolRegistry();
  registerMcpConnection(registry, {
    kind: "mcp", transport: "stdio", name: "fidelity", auth: { kind: "none" }, attachedAt: 0,
    stdio: { command: process.execPath, args: [script] }, tools: [{
      toolName: "mcp_fidelity_read", remoteName: "read", description: "Read fixture.", inputSchema: { type: "object", properties: {} },
    }],
  });
  const handler = registry.get("mcp_fidelity_read")!.handler;
  try {
    const [slow, quick, failure] = await Promise.all([
      handler({ token: "slow", delay: 80 }, undefined, undefined, { scope }),
      handler({ token: "quick", delay: 1 }, undefined, undefined, { scope }),
      handler({ fail: true }, undefined, undefined, { scope }),
    ]);
    assert(slow.ok); assert(quick.ok);
    const a = JSON.parse(slow.output), b = JSON.parse(quick.output);
    assert.equal(a.token, "slow"); assert.equal(b.token, "quick");
    assert.equal(a.pid, b.pid, "concurrent cold calls share one initialized process");
    assert.equal(a.calls, 3); assert.equal(b.calls, 3);
    assert.equal(a.payload, "🧪Evidence".repeat(20000)); assert.equal(b.payload, a.payload);
    assert.equal(failure.ok, false);
    if (!failure.ok) { assert.match(failure.error, /ev_stdio_fixture/); assert.match(failure.error, /health_not_ready/); }
  } finally {
    await closeStdioMcp("fidelity", scope);
    if (previous === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT; else process.env.AGENT_GLOBAL_STORAGE_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("liminal-mcp-fidelity-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});
