import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAgentcardCardAmount } from "./agentcard_cli.js";

test("normalizeAgentcardCardAmount rounds up and clamps", () => {
  assert.deepEqual(normalizeAgentcardCardAmount(24.99), { ok: true, amount: 25 });
  assert.deepEqual(normalizeAgentcardCardAmount(1), { ok: true, amount: 1 });
  assert.equal(normalizeAgentcardCardAmount(151).ok, false);
  assert.equal(normalizeAgentcardCardAmount(0).ok, false);
});

test("matchesAgentcardIntent accepts spaced agent card", async () => {
  const { matchesAgentcardIntent } = await import("./agentcard_cli.js");
  assert.equal(matchesAgentcardIntent("set up agent card"), true);
  assert.equal(matchesAgentcardIntent("build agentcard"), true);
  assert.equal(matchesAgentcardIntent("hello world"), false);
});

test("bootstrapAgentcardTools activates family when lazy", async () => {
  const { ToolRegistry } = await import("@liminal/core");
  const { createAgentcardTools, bootstrapAgentcardTools } = await import("./agentcard_tools.js");
  const registry = new ToolRegistry();
  for (const t of createAgentcardTools()) registry.register(t);
  registry.setToolFamilyLookup(new Map([["agentcard_whoami", "agentcard"]]));
  registry.setLazyToolLoading(true);
  registry.seedActiveTools([]);
  const newly = bootstrapAgentcardTools(registry);
  assert.ok(newly.length > 0);
  assert.ok(registry.isActive("agentcard_whoami"));
});
