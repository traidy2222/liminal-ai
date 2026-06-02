import test from "node:test";
import assert from "node:assert/strict";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";

test("default provider strategy is price (live benchmark default)", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PROVIDER_STRATEGY, "price");
});
