import test from "node:test";
import assert from "node:assert/strict";
import {
  EVAL_DEFAULT_FAST_MODEL,
  EVAL_DEFAULT_MAIN_MODEL,
  EVAL_MANAGED_BEDROCK_ENV,
  mergeEvalManagedEnv,
} from "./evalProvider.js";

test("mergeEvalManagedEnv applies GLM Bedrock stack for desktop parity", () => {
  const prev = process.env["EVAL_DESKTOP_PARITY"];
  try {
    process.env["EVAL_DESKTOP_PARITY"] = "1";
    delete process.env["EVAL_MANAGED_DEFAULTS"];
    delete process.env["EVAL_SANDBOX_LAB"];

    const merged = mergeEvalManagedEnv({ AGENT_WORKSPACE_ROOT: "/tmp/x" });
    assert.equal(merged["AGENT_MODEL"], EVAL_DEFAULT_MAIN_MODEL);
    assert.equal(merged["AGENT_FAST_MODEL"], EVAL_DEFAULT_FAST_MODEL);
    assert.equal(merged["AGENT_MANAGED_PROVIDER"], "bedrock");
    assert.equal(merged["AGENT_INFERENCE_MODE"], "managed");
    assert.equal(merged["AGENT_WORKSPACE_ROOT"], "/tmp/x");
  } finally {
    if (prev === undefined) delete process.env["EVAL_DESKTOP_PARITY"];
    else process.env["EVAL_DESKTOP_PARITY"] = prev;
  }
});

test("mergeEvalManagedEnv is no-op when managed defaults disabled", () => {
  const prevParity = process.env["EVAL_DESKTOP_PARITY"];
  const prevDefaults = process.env["EVAL_MANAGED_DEFAULTS"];
  try {
    delete process.env["EVAL_DESKTOP_PARITY"];
    delete process.env["EVAL_SANDBOX_LAB"];
    process.env["EVAL_MANAGED_DEFAULTS"] = "0";
    const merged = mergeEvalManagedEnv({ foo: "bar" });
    assert.deepEqual(merged, { foo: "bar" });
    assert.equal(merged["AGENT_MODEL"], undefined);
  } finally {
    if (prevParity === undefined) delete process.env["EVAL_DESKTOP_PARITY"];
    else process.env["EVAL_DESKTOP_PARITY"] = prevParity;
    if (prevDefaults === undefined) delete process.env["EVAL_MANAGED_DEFAULTS"];
    else process.env["EVAL_MANAGED_DEFAULTS"] = prevDefaults;
  }
});

test("EVAL_MANAGED_BEDROCK_ENV pins GLM models", () => {
  assert.equal(EVAL_MANAGED_BEDROCK_ENV["AGENT_MODEL"], "zai.glm-5");
  assert.equal(EVAL_MANAGED_BEDROCK_ENV["AGENT_FAST_MODEL"], "zai.glm-4.7-flash");
});
