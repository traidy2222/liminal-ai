import test from "node:test";
import assert from "node:assert/strict";
import { isNearDuplicateSpokenLine, TtsTurnBudget } from "./tts_budget.js";
import { resolveSpeechSynthesisConfig } from "./speech_synthesis.js";

test("isNearDuplicateSpokenLine allows longer continuation clips", () => {
  assert.equal(isNearDuplicateSpokenLine("hello there", "hello there"), true);
  assert.equal(
    isNearDuplicateSpokenLine("short opener", "short opener with much more detail about the plan"),
    false
  );
  assert.equal(
    isNearDuplicateSpokenLine("searching the codebase", "searching the codebase now"),
    false
  );
});

test("TtsTurnBudget allows continuation speak after short opener", () => {
  const budget = new TtsTurnBudget();
  const cfg = { ...resolveSpeechSynthesisConfig(null), enabled: true, minIntervalMs: 800 };
  const first = budget.tryConsume("Here is the short opener.", cfg, 1000);
  assert.equal(first.ok, true);
  const second = budget.tryConsume(
    "Here is the short opener. And here is the rest of the answer you asked for.",
    cfg,
    1100
  );
  assert.equal(second.ok, true, second.reason);
});

test("TtsTurnBudget allows small extension of prior spoken line", () => {
  const budget = new TtsTurnBudget();
  const cfg = { ...resolveSpeechSynthesisConfig(null), enabled: true, minIntervalMs: 800 };
  assert.equal(budget.tryConsume("searching the codebase", cfg, 1000).ok, true);
  const extended = budget.tryConsume("searching the codebase now", cfg, 1050);
  assert.equal(extended.ok, true, extended.reason);
});
