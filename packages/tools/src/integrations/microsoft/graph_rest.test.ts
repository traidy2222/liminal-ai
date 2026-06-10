import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { graphJsonResult, graphApiFetchWithDeps } from "./graph_rest.js";

test("graphJsonResult formats JSON output", () => {
  const r = graphJsonResult({ id: 1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.output.includes('"id": 1'));
  }
});

test("graphApiFetch retries on 429", async () => {
  let calls = 0;
  const fetchMock = mock.fn(async () => {
    calls++;
    if (calls === 1) {
      return new Response("throttled", { status: 429, headers: { "Retry-After": "0" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const res = await graphApiFetchWithDeps(
    "/me",
    {
      getToken: async () => "test-token",
      fetchFn: fetchMock as unknown as typeof fetch,
      restEnabled: () => true,
    },
    { retries: 3 }
  );

  assert.equal(res.status, 200);
  assert.ok(calls >= 2);
});
