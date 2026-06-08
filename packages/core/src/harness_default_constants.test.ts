import test from "node:test";
import assert from "node:assert/strict";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";

test("HARNESS_ENV_DEFAULTS: context hygiene on by default", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_TOOL_BODY_ELIDE, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_DISTILL, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_DISTILL_READ_FILE, "0");
});

test("HARNESS_ENV_DEFAULTS: smarter routing defaults", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_REASONING_DEFAULT_EFFORT, "medium");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_COMPLEXITY_ROUTING, "1");
});

test("HARNESS_ENV_DEFAULTS: verification sub-agents off by default", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_VERIFY_TOOLS, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_CRITIC, "0");
});

test("HARNESS_ENV_DEFAULTS: long-horizon reliability (low-overhead subset)", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_YIELD_EVERY_N, "4");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MISSION_AUTONOMY, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MISSION_REQUIRES_YOLO, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MEMORY_AUTO_EXTRACT, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_AUTO_DREAM, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PASTE, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_INTENT_REPO_CONTEXT, "1");
});

test("resolveHarnessEnvRaw falls back to typed defaults when unset", () => {
  const prev = process.env.AGENT_TOOL_BODY_ELIDE;
  delete process.env.AGENT_TOOL_BODY_ELIDE;
  try {
    assert.equal(resolveHarnessEnvRaw("AGENT_TOOL_BODY_ELIDE", null), "1");
    assert.equal(resolveHarnessEnvRaw("AGENT_COMPLEXITY_ROUTING", null), "1");
  } finally {
    if (prev !== undefined) process.env.AGENT_TOOL_BODY_ELIDE = prev;
  }
});
