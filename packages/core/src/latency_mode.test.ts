import test from "node:test";
import assert from "node:assert/strict";
import {
  LATENCY_MODE_ENV_PATCHES,
  latencyModeEnabled,
  latencyModePatchForKey,
} from "./latency_mode.js";

test("latencyModeEnabled reads prefs and env", () => {
  assert.equal(latencyModeEnabled({ harness: { env: { AGENT_LATENCY_MODE: "1" } } }), true);
  const prev = process.env["AGENT_LATENCY_MODE"];
  try {
    process.env["AGENT_LATENCY_MODE"] = "true";
    assert.equal(latencyModeEnabled(null), true);
  } finally {
    if (prev === undefined) delete process.env["AGENT_LATENCY_MODE"];
    else process.env["AGENT_LATENCY_MODE"] = prev;
  }
});

test("latencyModePatchForKey applies when on and key unset", () => {
  const prefs = { harness: { env: { AGENT_LATENCY_MODE: "1" } } };
  assert.equal(latencyModePatchForKey("AGENT_WORLD_CONTEXT", prefs), "0");
});

test("latencyModePatchForKey skips explicit prefs override", () => {
  const prefs = {
    harness: {
      env: {
        AGENT_LATENCY_MODE: "1",
        AGENT_WORLD_CONTEXT: "1",
      },
    },
  };
  assert.equal(latencyModePatchForKey("AGENT_WORLD_CONTEXT", prefs), undefined);
});

test("latency mode patches include intent off; edit lint stays available", () => {
  assert.equal(LATENCY_MODE_ENV_PATCHES["AGENT_INTENT_INFERENCE"], "0");
  assert.equal(LATENCY_MODE_ENV_PATCHES["AGENT_PROACTIVE_VERIFY"], "0");
  assert.equal(LATENCY_MODE_ENV_PATCHES["AGENT_PROACTIVE_VERIFY_LINT"], undefined);
  assert.equal(LATENCY_MODE_ENV_PATCHES["AGENT_USER_REPLY_FINALIZE"], "0");
});
