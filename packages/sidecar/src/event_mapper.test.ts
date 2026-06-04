import { test } from "node:test";
import assert from "node:assert/strict";
import { wireToolApproval, wireAskUser, wireError, wireToolResult } from "./event_mapper.js";

test("wireToolApproval strips the resolver and attaches the nonce", () => {
  let resolved = false;
  const wire = wireToolApproval(
    {
      callId: "c1",
      name: "run_shell",
      args: { cmd: "ls" },
      approvalTimeoutMs: 120_000,
      resolve: () => {
        resolved = true;
      },
    },
    "nonce-abc"
  );
  assert.equal(wire.callId, "c1");
  assert.equal(wire.approvalNonce, "nonce-abc");
  assert.equal(wire.approvalTimeoutMs, 120_000);
  assert.ok(!("resolve" in wire), "resolver must not cross the wire");
  // Must be JSON-serializable (no functions survive).
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(wire)));
  assert.equal(resolved, false);
});

test("wireAskUser keeps only the prompt", () => {
  const wire = wireAskUser({ prompt: "Which file?", resolve: () => {} });
  assert.deepEqual(wire, { prompt: "Which file?" });
});

test("wireError flattens a thrown Error to JSON-safe fields", () => {
  const wire = wireError({ err: new TypeError("boom") });
  assert.equal(wire.message, "boom");
  assert.equal(wire.name, "TypeError");
  assert.ok(typeof wire.stack === "string");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(wire)));
});

test("wireToolResult caps an oversized ok output", () => {
  const big = "x".repeat(60_000);
  const wire = wireToolResult({
    callId: "c2",
    name: "read_file",
    args: {},
    result: { ok: true, output: big },
  });
  assert.equal(wire.result.ok, true);
  if (wire.result.ok) {
    assert.ok(wire.result.output.length < big.length);
    assert.match(wire.result.output, /truncated after 48000 characters/);
  }
});

test("wireToolResult passes a small error result through", () => {
  const wire = wireToolResult({
    callId: "c3",
    name: "run_tests",
    args: {},
    result: { ok: false, error: "1 failing" },
  });
  assert.equal(wire.result.ok, false);
  if (!wire.result.ok) assert.equal(wire.result.error, "1 failing");
});
