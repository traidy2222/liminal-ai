import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  withProviderRequestSpacing,
  resolveProviderMinIntervalMs,
} from "./provider_request_gate.js";

function setIntervalForTest(t: TestContext, value: string): void {
  const previous = process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
  t.after(() => {
    if (previous === undefined) delete process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
    else process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"] = previous;
  });
  process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"] = value;
}

test("resolveProviderMinIntervalMs reads env", (t) => {
  setIntervalForTest(t, "100");
  assert.equal(resolveProviderMinIntervalMs(), 100);
  delete process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
  assert.equal(resolveProviderMinIntervalMs(), 0);
});

test("withProviderRequestSpacing serializes starts when interval > 0", async (t) => {
  setIntervalForTest(t, "45");
  const creds = { apiKey: "test-key-a", baseURL: "https://openrouter.ai/api/v1" };
  const starts: number[] = [];
  const p1 = withProviderRequestSpacing(creds, async () => {
    starts.push(Date.now());
    await new Promise<void>((r) => setTimeout(r, 4));
  });
  const p2 = withProviderRequestSpacing(creds, async () => {
    starts.push(Date.now());
  });
  await Promise.all([p1, p2]);
  assert.equal(starts.length, 2);
  const delta = starts[1]! - starts[0]!;
  assert.ok(delta >= 25, `expected spacing ~45ms+, got ${delta}ms`);
});

test("different API keys run in parallel when interval > 0", async (t) => {
  setIntervalForTest(t, "80");
  const order: string[] = [];
  const a = withProviderRequestSpacing(
    { apiKey: "key-a", baseURL: "https://openrouter.ai/api/v1" },
    async () => {
      order.push("a-start");
      await new Promise<void>((r) => setTimeout(r, 5));
      order.push("a-end");
    }
  );
  const b = withProviderRequestSpacing(
    { apiKey: "key-b", baseURL: "https://openrouter.ai/api/v1" },
    async () => {
      order.push("b");
    }
  );
  await Promise.all([a, b]);
  assert.ok(order.indexOf("b") > order.indexOf("a-start"));
  assert.ok(order.indexOf("b") < order.indexOf("a-end"), "key B must start before key A finishes");
});
