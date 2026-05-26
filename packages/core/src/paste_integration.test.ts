/**
 * Integration test: prove the speculate→promote round-trip uses the same args
 * key normalization (stableArgsJsonKey) so the model's actual call promotes the
 * in-flight speculation regardless of property order.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PasteScheduler } from "./paste_scheduler.js";
import { stableArgsJsonKey } from "./json_stable.js";
import type { ToolResult } from "./types.js";

test("speculate then promote matches when property order differs", async () => {
  const s = new PasteScheduler();
  const speculatedArgs = { url: "https://example.com", timeout_ms: 5000 };
  const speculatedArgsJson = JSON.stringify(speculatedArgs);
  const speculatedKey = stableArgsJsonKey(speculatedArgsJson);
  s.start(
    { toolName: "web_fetch", args: speculatedArgs, probability: 0.9, estimatedLatencyMs: 0 },
    speculatedKey,
    async () => ({ ok: true, output: "speculated body" } satisfies ToolResult)
  );
  // The model now emits the same call with property order swapped.
  const modelArgsJson = JSON.stringify({ timeout_ms: 5000, url: "https://example.com" });
  const modelKey = stableArgsJsonKey(modelArgsJson);
  const promoted = s.promote("web_fetch", modelKey);
  assert.ok(promoted, "must promote despite property-order difference");
  const result = await promoted!;
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.output, "speculated body");
  assert.equal(s.stats().promoted, 1);
});

test("speculate does not promote a call with different args", async () => {
  const s = new PasteScheduler();
  s.start(
    {
      toolName: "web_fetch",
      args: { url: "https://example.com/a" },
      probability: 0.9,
      estimatedLatencyMs: 0,
    },
    stableArgsJsonKey(JSON.stringify({ url: "https://example.com/a" })),
    async () => ({ ok: true, output: "a" } satisfies ToolResult)
  );
  const otherKey = stableArgsJsonKey(JSON.stringify({ url: "https://example.com/b" }));
  assert.equal(s.promote("web_fetch", otherKey), null);
});
