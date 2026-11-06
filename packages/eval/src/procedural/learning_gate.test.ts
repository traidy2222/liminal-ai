import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "@liminal/core";
import { freezeHeldOutLearning } from "./learning_gate.js";
test("held-out evaluator blocks procedure promotion/corrections but preserves evidence inspection", async () => {
  const registry = new ToolRegistry();
  let called = 0;
  registry.register({
    name: "procedure_memory",
    description: "fixture",
    requiresApproval: false,
    parameters: { type: "object", properties: {} },
    handler: async () => {
      called++;
      return { ok: true, output: "original handler" };
    },
  });
  freezeHeldOutLearning(registry);
  const tool = registry.get("procedure_memory")!;
  assert.deepEqual(tool.parameters.properties.action!.enum, [
    "list",
    "inspect",
    "audit",
    "evidence",
  ]);
  for (const action of ["learn", "validate", "derive", "correct", "retire"])
    assert.equal((await tool.handler({ action })).ok, false);
  assert.equal(called, 0);
  assert((await tool.handler({ action: "inspect" })).ok);
  assert((await tool.handler({ action: "audit" })).ok);
  assert.equal(called, 2);
});
