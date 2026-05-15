import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHeartbeatTickJson,
  decideUserNudgeSurface,
  resolvePersonalityHeartbeatConfig,
} from "./personality_heartbeat.js";

test("parseHeartbeatTickJson accepts empty memory_candidates and missing reflections", () => {
  const tick = parseHeartbeatTickJson({
    reflections: [],
    memory_candidates: [],
    user_nudge: null,
  });
  assert.ok(tick);
  assert.deepEqual(tick!.reflections, []);
  assert.deepEqual(tick!.memory_candidates, []);
  assert.equal(tick!.user_nudge, null);
});

test("parseHeartbeatTickJson filters invalid memory types", () => {
  const tick = parseHeartbeatTickJson({
    reflections: ["a"],
    memory_candidates: [
      { key: "k1", value: "v1", type: "reflection" },
      { key: "bad", value: "x", type: "not_a_real_type" },
    ],
    user_nudge: null,
  });
  assert.ok(tick);
  assert.equal(tick!.memory_candidates.length, 1);
  assert.equal(tick!.memory_candidates[0]!.key, "k1");
});

test("decideUserNudgeSurface respects confidence and hourly cap", () => {
  const cfg = resolvePersonalityHeartbeatConfig(null);
  const highCfg = { ...cfg, userNudgeConfidenceMin: 0.5, maxUserNudgesPerHour: 1, surface: "trace" as const };
  const tick = {
    reflections: [],
    memory_candidates: [],
    user_nudge: { text: "Try X?", confidence: 0.4, rationale: "low" },
  };
  assert.equal(decideUserNudgeSurface({ cfg: highCfg, tick, nudgeTimestampsHour: [] }).decision, "none");

  const okTick = {
    reflections: [],
    memory_candidates: [],
    user_nudge: { text: "Try X?", confidence: 0.92, rationale: "ok" },
  };
  assert.equal(
    decideUserNudgeSurface({ cfg: highCfg, tick: okTick, nudgeTimestampsHour: [Date.now()] }).decision,
    "none"
  );

  const surf = decideUserNudgeSurface({
    cfg: { ...highCfg, maxUserNudgesPerHour: 3 },
    tick: okTick,
    nudgeTimestampsHour: [],
  });
  assert.equal(surf.decision, "trace");
  assert.ok(surf.nudgeText?.includes("Try"));
});

test("resolvePersonalityHeartbeatConfig defaults to disabled", () => {
  const c = resolvePersonalityHeartbeatConfig(null);
  assert.equal(c.enabled, false);
});
