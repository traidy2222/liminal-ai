import assert from "node:assert/strict";
import test from "node:test";
import { buildContextPolicy } from "./context_policy.js";

test("buildContextPolicy tiers small context windows", () => {
  const p = buildContextPolicy({ contextLength: 100_000, source: "openrouter" });
  assert.equal(p.tier, "small");
  assert.equal(p.hotRounds, 2);
  assert.equal(p.preflightPasses, 6);
});

test("buildContextPolicy tiers large context windows", () => {
  const p = buildContextPolicy({ contextLength: 202_752, source: "openrouter" });
  assert.equal(p.tier, "large");
  assert.equal(p.hotRounds, 4);
});

test("buildContextPolicy carries maxCompletionTokens", () => {
  const p = buildContextPolicy({
    contextLength: 128_000,
    maxCompletionTokens: 8192,
    source: "managed_api",
  });
  assert.equal(p.maxCompletionTokens, 8192);
});
