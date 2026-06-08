import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { graphJsonResult } from "./graph_rest.js";

test("graphJsonResult formats JSON output", () => {
  const r = graphJsonResult({ id: 1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.output.includes('"id": 1'));
  }
});

test("graphApiFetch retries on 429", async () => {
  const core = await import("@liminal/core");
  const tokenMock = mock.fn(async () => "test-token");
  mock.method(core, "getMicrosoftAccessToken", tokenMock);
  mock.method(core, "effectiveHarnessEnvRaw", (key: string) =>
    key === "AGENT_MICROSOFT_REST" ? "1" : undefined
  );

  const { graphApiFetch } = await import("./graph_rest.js");
  let calls = 0;
  const fetchMock = mock.fn(async () => {
    calls++;
    if (calls === 1) {
      return new Response("throttled", { status: 429, headers: { "Retry-After": "0" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  mock.method(globalThis, "fetch", fetchMock);

  const res = await graphApiFetch("/me");
  assert.equal(res.status, 200);
  assert.ok(calls >= 2);

  mock.restoreAll();
});
