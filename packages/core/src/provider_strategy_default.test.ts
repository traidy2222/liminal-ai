import test from "node:test";
import assert from "node:assert/strict";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";

test("default provider strategy balances price and measured speed", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PROVIDER_STRATEGY, "adaptive");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PROVIDER_SORT, "");
});
