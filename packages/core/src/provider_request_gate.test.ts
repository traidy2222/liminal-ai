import test from "node:test";
import assert from "node:assert/strict";
import {
  withProviderRequestSpacing,
  resolveProviderMinIntervalMs,
} from "./provider_request_gate.js";

test("resolveProviderMinIntervalMs reads env", () => {
  process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"] = "100";
  assert.equal(resolveProviderMinIntervalMs(), 100);
  delete process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
  assert.equal(resolveProviderMinIntervalMs(), 0);
});

test("withProviderRequestSpacing serializes when interval > 0", async () => {
  process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"] = "45";
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
  delete process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
});

test("different API keys run in parallel when interval > 0", async () => {
  process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"] = "80";
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
  assert.ok(order.includes("b"));
  delete process.env["AGENT_PROVIDER_MIN_INTERVAL_MS"];
});
