import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRouteState } from "./provider_route_state.js";

test("ProviderRouteState accumulates ignores and bumps epoch", () => {
  const state = new ProviderRouteState();
  assert.deepEqual(state.snapshot(), { ignore: [], epoch: 0 });
  assert.equal(state.resolveSessionId("chat-1"), "chat-1");

  state.markProviderRateLimited("DeepInfra", { bumpEpoch: true });
  assert.deepEqual(state.snapshot().ignore, ["DeepInfra"]);
  assert.equal(state.snapshot().epoch, 1);
  assert.equal(state.resolveSessionId("chat-1"), "chat-1#1");

  state.markProviderRateLimited("Together");
  assert.deepEqual(state.snapshot().ignore.sort(), ["DeepInfra", "Together"]);
  assert.equal(state.snapshot().epoch, 1);

  state.reset();
  assert.deepEqual(state.snapshot(), { ignore: [], epoch: 0 });
});
