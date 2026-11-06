import test from "node:test";
import assert from "node:assert/strict";
import { ContextManager } from "./context.js";
import { applyPromptCacheBreakpoints } from "./prompt_cache.js";
import { ToolDispatcher } from "./dispatcher.js";
import { ToolRegistry } from "./registry.js";
import { AgentEmitter } from "./events.js";

test("tool/intent/permission changes leave the cached prefix and history unchanged", async () => {
  const ctx = new ContextManager({ inceptionMessages: [
    { role: "system", content: "Stable identity" }, { role: "system", content: "Stable authorization policy" },
  ], modelMaxTokens: 100000, protocolDynamicBuilder: (tools, intent) => `${intent}: ${tools.join(",")}` });
  ctx.append({ role: "user", content: "Perform the requested task" });
  ctx.append({ role: "assistant", content: "Existing history" });
  ctx.setProtocolIntentHint("knowledge"); ctx.refreshProtocolDynamic(["read_file"]);
  ctx.setRuntimePermissions({ mode: "destructive_only", may_request_approval: ["run_shell"] });
  const before = applyPromptCacheBreakpoints(await ctx.buildMessages());
  ctx.setProtocolIntentHint("execution"); ctx.refreshProtocolDynamic(["read_file", "browser_open"]);
  ctx.setRuntimePermissions({ mode: "automatic", may_request_approval: [] });
  const after = applyPromptCacheBreakpoints(await ctx.buildMessages());
  assert.deepEqual(before.slice(0, 4), after.slice(0, 4));
  assert.notDeepEqual(before.slice(4), after.slice(4));
  assert.match(String(after[4]!.content), /browser_open/);
  assert.deepEqual(ctx.getEffectiveInception(), [
    { role: "system", content: "Stable identity" }, { role: "system", content: "Stable authorization policy" },
  ]);
  assert.equal(typeof after[4]!.content, "string", "runtime capabilities must not be a cache breakpoint");
  assert.equal(typeof after[5]!.content, "string", "permissions must not be a cache breakpoint");
  assert.deepEqual(await ctx.buildMessages(), ctx.buildMessagesSync());
  ctx.clear(); assert.ok(!(await ctx.buildMessages()).some(m => String(m.content).includes("RUNTIME PERMISSIONS")));
});

test("empty conversation still caches only the static prefix", async () => {
  const ctx = new ContextManager({ inceptionMessages: [{ role: "system", content: "Stable core" }],
    modelMaxTokens: 100000, protocolDynamicBuilder: () => "Changing tools" });
  ctx.refreshProtocolDynamic(["browser_open"]); ctx.setRuntimePermissions({ mode: "automatic" });
  const messages = applyPromptCacheBreakpoints(await ctx.buildMessages());
  assert.ok(Array.isArray(messages[0]!.content));
  assert.equal(typeof messages[1]!.content, "string"); assert.equal(typeof messages[2]!.content, "string");
});

test("current turn data replaces stale settings without modifying history or the cached prefix", async () => {
  const ctx = new ContextManager({ inceptionMessages: [{ role: "system", content: "Stable core" }], modelMaxTokens: 100000 });
  ctx.append({ role: "user", content: "First request" });
  ctx.setTurnContext("settings", 'output_effort=high');
  ctx.setTurnContext("paths", 'Suggested paths: first.ts');
  const before = applyPromptCacheBreakpoints(await ctx.buildMessages(), 1);
  ctx.append({ role: "assistant", content: "First result" });
  ctx.clearTurnContext();
  ctx.append({ role: "user", content: "Second request" });
  ctx.setTurnContext("settings", 'output_effort=low');
  ctx.setTurnContext("settings", 'output_effort=medium');
  const after = applyPromptCacheBreakpoints(await ctx.buildMessages(), 1);
  assert.deepEqual(before[0], after[0]);
  const text = JSON.stringify(after);
  assert.match(text, /First result|Second request/);
  assert.match(text, /output_effort=medium/);
  assert.doesNotMatch(text, /output_effort=high|output_effort=low|first.ts/);
  assert.equal(after.filter(m => JSON.stringify(m.content).includes("[TURN CONTEXT]")).length, 1);
  assert.deepEqual(await ctx.buildMessages(), ctx.buildMessagesSync());
  ctx.setTurnContext("settings", "");
  assert.ok(!(await ctx.buildMessages()).some(m => String(m.content).includes("[TURN CONTEXT]")));
  ctx.setTurnContext("settings", "stale"); ctx.clear();
  assert.ok(!(await ctx.buildMessages()).some(m => String(m.content).includes("stale")));
});

test("explicit inception boundary excludes per-turn system notes before the first user message", () => {
  const messages = [
    { role: "system" as const, content: "Stable identity" },
    { role: "system" as const, content: "Stable protocol" },
    { role: "system" as const, content: "A changing per-turn instruction" },
    { role: "user" as const, content: "Current task" },
  ];
  const before = applyPromptCacheBreakpoints(messages, 2);
  const after = applyPromptCacheBreakpoints(messages.map((m, index) => index === 2 ? { ...m, content: "Different task state" } : m), 2);
  assert.deepEqual(before.slice(0, 2), after.slice(0, 2));
  assert.ok(Array.isArray(before[1]!.content));
  assert.equal(typeof before[2]!.content, "string");
});

test("permission state agrees with dispatcher: cautious browser work does not ask", async () => {
  const registry = new ToolRegistry(); const emitter = new AgentEmitter();
  let approvals = 0, invoked = 0;
  emitter.on("approval_request", () => { approvals++; });
  registry.register({ name: "browser_open", description: "browser", dangerLevel: "cautious", requiresApproval: true,
    parameters: { type: "object", properties: {} }, handler: async () => { invoked++; return { ok: true, output: "inspected" }; } });
  registry.register({ name: "danger_fixture", description: "destructive", dangerLevel: "destructive", requiresApproval: true,
    parameters: { type: "object", properties: {} }, handler: async () => ({ ok: true, output: "done" }) });
  const dispatcher = new ToolDispatcher(registry, emitter);
  assert.deepEqual(dispatcher.approvalState().may_request_approval, ["danger_fixture"]);
  const result = await dispatcher.dispatch("call-browser", "browser_open", "{}");
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(approvals, 0); assert.equal(invoked, 1);
  const automatic = new ToolDispatcher(registry, emitter, undefined, undefined, undefined, 1000, true);
  assert.equal(automatic.approvalState().mode, "automatic"); assert.deepEqual(automatic.approvalState().may_request_approval, []);
});
