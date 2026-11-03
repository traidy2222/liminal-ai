import test from "node:test";
import assert from "node:assert/strict";
import { waitForIdaHealth } from "./health-readiness.mjs";

const ready = { status: "ok", input_path: "/owned/target", idb_path: "/owned/idb", imagebase: "0x400000", auto_analysis_ready: true, module: "target" };
const busy = { status: "busy", uptime_sec: 1, busy_tool: "decompile", busy_sec: 0.1, queued_calls: 0 };
function harness(states, overrides = {}) {
  let now = 0, calls = 0, validated = 0;
  const options = [];
  return {
    options, calls: () => calls, validated: () => validated,
    run: () => waitForIdaHealth({
      callHealth: async option => { options.push(option); return states[Math.min(calls++, states.length - 1)]; },
      parseHealth: raw => {
        if (!raw || raw.status !== "ok" || typeof raw.auto_analysis_ready !== "boolean") throw new Error("malformed health payload");
        return raw;
      },
      validateIdentity: metadata => { validated++; assert.equal(metadata.input_path, ready.input_path, "identity mismatch"); },
      protocolError: message => new Error(message), budgetMs: 250,
      timeoutError: budget => Object.assign(new Error(`readiness timeout within ${budget} ms; no analysis operation was replayed`), {
        _tag: "AnalysisTimeoutError", operation: "server_health: headless analysis readiness", timeoutMs: budget,
      }),
      now: () => now, sleep: async ms => { now += ms; }, ...overrides,
    }),
  };
}

test("busy then valid ready health succeeds without replaying an analysis operation", async () => {
  const h = harness([busy, ready]);
  assert.deepEqual(await h.run(), { raw: ready, metadata: ready });
  assert.equal(h.calls(), 2); assert.equal(h.validated(), 1);
  assert.deepEqual(h.options.map(o => o.timeoutMs), [250, 150]);
});
test("valid incomplete analysis gets bounded health polls and validates identity each time", async () => {
  const h = harness([{ ...ready, auto_analysis_ready: false }, ready]);
  await h.run(); assert.equal(h.calls(), 2); assert.equal(h.validated(), 2);
});
test("incomplete readiness times out under monotonic configured budget", async () => {
  const h = harness([{ ...ready, auto_analysis_ready: false }]);
  await assert.rejects(h.run(), error => {
    assert.equal(error._tag, "AnalysisTimeoutError");
    assert.equal(error.operation, "server_health: headless analysis readiness");
    assert.equal(error.timeoutMs, 250);
    return true;
  });
  assert.equal(h.calls(), 3);
});
test("readiness timeout uses a distinct timeout factory, never the malformed/protocol factory", async () => {
  const expected = new Error("projected analysis_timeout");
  const h = harness([busy], {
    budgetMs: 10,
    protocolError: () => { throw new Error("wrong protocol error factory"); },
    timeoutError: budget => { assert.equal(budget, 10); return expected; },
  });
  await assert.rejects(h.run(), error => error === expected);
});
test("cancellation during polling and before first call never dispatches another health request", async () => {
  const controller = new AbortController();
  const reason = new Error("turn stopped");
  const h = harness([busy, ready], { signal: controller.signal, sleep: async () => controller.abort(reason) });
  await assert.rejects(h.run(), error => error === reason); assert.equal(h.calls(), 1);
  const pre = harness([ready], { signal: controller.signal });
  await assert.rejects(pre.run(), error => error === reason); assert.equal(pre.calls(), 0);
});
test("pending health request cancellation and wall-clock timeout complete without waiting for a producer", async () => {
  const controller = new AbortController();
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const h = harness([], { signal: controller.signal, callHealth: () => { started(); return new Promise(() => {}); } });
  const pending = h.run(); await entered; controller.abort(new Error("stopped pending health"));
  await assert.rejects(pending, /stopped pending health/);
  const timeout = harness([], { budgetMs: 20, callHealth: () => new Promise(() => {}) });
  await assert.rejects(timeout.run(), /within 20 ms/);
});
test("malformed producer payloads and invalid busy records are not retried", async () => {
  for (const payload of [{ status: "busy" }, { status: "broken" }, { ...ready, auto_analysis_ready: "yes" }]) {
    const h = harness([payload, ready]);
    await assert.rejects(h.run(), /malformed health/); assert.equal(h.calls(), 1);
  }
});
test("changed target identity is rejected even while auto-analysis is not ready", async () => {
  const h = harness([{ ...ready, input_path: "/foreign/target", auto_analysis_ready: false }, ready]);
  await assert.rejects(h.run(), /identity mismatch/); assert.equal(h.calls(), 1);
});
test("unknown readiness is not silently promoted to ready or retried", async () => {
  const h = harness([{ ...ready, auto_analysis_ready: null }], { parseHealth: value => value });
  await assert.rejects(h.run(), /readiness is unknown/); assert.equal(h.calls(), 1);
});
