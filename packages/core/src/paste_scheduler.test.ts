import test from "node:test";
import assert from "node:assert/strict";
import { PasteScheduler } from "./paste_scheduler.js";
import type { ToolDefinition, ToolResult } from "./types.js";

function fakeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "web_fetch",
    description: "test",
    parameters: { type: "object", properties: {} },
    requiresApproval: false,
    handler: async () => ({ ok: true, output: "ok" }),
    dangerLevel: "safe",
    ...overrides,
  };
}

test("isEligible accepts safe non-approval tools", () => {
  const s = new PasteScheduler({ minProbability: 0.5 });
  const def = fakeTool();
  assert.equal(
    s.isEligible(
      { toolName: "web_fetch", args: {}, probability: 0.8, estimatedLatencyMs: 500 },
      def
    ),
    true
  );
});

test("isEligible rejects approval-required tools", () => {
  const s = new PasteScheduler();
  const def = fakeTool({ requiresApproval: true });
  assert.equal(
    s.isEligible(
      { toolName: "web_fetch", args: {}, probability: 1.0, estimatedLatencyMs: 0 },
      def
    ),
    false
  );
});

test("isEligible rejects destructive tools", () => {
  const s = new PasteScheduler();
  const def = fakeTool({ dangerLevel: "destructive" });
  assert.equal(
    s.isEligible(
      { toolName: "run_shell", args: {}, probability: 1.0, estimatedLatencyMs: 0 },
      def
    ),
    false
  );
});

test("isEligible rejects below minProbability", () => {
  const s = new PasteScheduler({ minProbability: 0.7 });
  const def = fakeTool();
  assert.equal(
    s.isEligible(
      { toolName: "web_fetch", args: {}, probability: 0.5, estimatedLatencyMs: 0 },
      def
    ),
    false
  );
});

test("promote returns the in-flight promise and marks promoted", async () => {
  const s = new PasteScheduler();
  let resolved = false;
  const job = s.start(
    { toolName: "web_fetch", args: { url: "x" }, probability: 0.9, estimatedLatencyMs: 0 },
    "u=x",
    async () => {
      resolved = true;
      return { ok: true, output: "body" } satisfies ToolResult;
    }
  );
  const promoted = s.promote("web_fetch", "u=x");
  assert.ok(promoted);
  const result = await promoted!;
  assert.equal(resolved, true);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.output, "body");
  assert.equal(s.stats().promoted, 1);
  // After promotion, the in-flight job is removed so a second promote misses.
  assert.equal(s.promote("web_fetch", "u=x"), null);
  assert.equal(job.promoted, true);
});

test("promote returns null when nothing matches", () => {
  const s = new PasteScheduler();
  assert.equal(s.promote("web_fetch", "u=missing"), null);
});

test("wasted speculations increment when not promoted", async () => {
  const s = new PasteScheduler();
  s.start(
    { toolName: "web_fetch", args: {}, probability: 0.9, estimatedLatencyMs: 0 },
    "u=a",
    async () => ({ ok: true, output: "" })
  );
  // Wait for the dispatch promise to settle so the finally-handler runs.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.stats().wasted, 1);
});

test("hasBudget false when concurrency cap reached", async () => {
  const s = new PasteScheduler({ maxConcurrent: 1, budgetMs: 60_000 });
  // Long-pending speculation occupies the only slot.
  s.start(
    { toolName: "web_fetch", args: {}, probability: 0.9, estimatedLatencyMs: 0 },
    "u=long",
    () => new Promise<ToolResult>(() => {
      /* never resolves */
    })
  );
  assert.equal(s.hasBudget(), false);
});
