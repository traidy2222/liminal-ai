import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { SharedMemoryBus } from "./shared_memory_bus.js";
import { TaskOrchestrator } from "./orchestrator.js";
import {
  buildSharedBusContext,
  buildUpstreamDependencyContext,
  finalizeChildSpawnTools,
} from "./spawn_provisioning.js";

test("finalizeChildSpawnTools activates discovery and collaboration tools", () => {
  const registry = new ToolRegistry();
  const familyMap = new Map<string, string>([
    ["grep_file", "code_intel"],
    ["list_tool_families", "meta"],
    ["activate_tool_family", "meta"],
    ["share_agent_context", "orchestration"],
    ["read_agent_context", "orchestration"],
  ]);
  const stub = (name: string) => ({
    name,
    description: "x",
    requiresApproval: false as const,
    parameters: { type: "object" as const, properties: {} },
    handler: async () => ({ ok: true as const, output: "" }),
  });
  registry.register(stub("list_tool_families"));
  registry.register(stub("activate_tool_family"));
  registry.register(stub("share_agent_context"));
  registry.register(stub("read_agent_context"));
  registry.register(stub("grep_file"));
  registry.setLazyToolLoading(true);
  registry.setToolFamilyLookup(familyMap);

  const result = finalizeChildSpawnTools(
    registry,
    { goal: "test", activateFamilies: ["code_intel"] },
    { canOrchestrate: false }
  );

  assert.ok(result.activeCount >= 4);
  assert.ok(registry.isActive("list_tool_families"));
  assert.ok(registry.isActive("share_agent_context"));
  assert.ok(registry.isActive("grep_file"));
});

test("buildUpstreamDependencyContext includes orchestrator results", () => {
  const orchestrator = new TaskOrchestrator();
  const bus = new SharedMemoryBus();
  const parentId = "parent-1";
  orchestrator.register({
    taskId: "dep-a",
    parentTaskId: parentId,
    goal: "Research pricing",
    depth: 1,
    startedAt: Date.now(),
    status: "done",
    result: "Found 3 competitors at $9/mo.",
    abortController: new AbortController(),
  });

  const ctx = buildUpstreamDependencyContext(orchestrator, bus, parentId, ["dep-a"]);
  assert.match(ctx, /Research pricing/);
  assert.match(ctx, /3 competitors/);
});

test("buildSharedBusContext reads keys and prefix", () => {
  const bus = new SharedMemoryBus();
  bus.publishEnvelope(
    "ctx/test/key1",
    { type: "summary", summary: "Pricing notes", payload: "Competitor A: $9", at: Date.now() },
    "pub-1"
  );
  bus.publish("ctx/test/key2", "plain value", "pub-1");

  const byKey = buildSharedBusContext(bus, { keys: ["ctx/test/key1"] });
  assert.match(byKey, /Competitor A/);

  const byPrefix = buildSharedBusContext(bus, { prefix: "ctx/test/" });
  assert.match(byPrefix, /plain value/);
});
