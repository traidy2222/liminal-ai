import test from "node:test";
import assert from "node:assert/strict";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";

test("default provider strategy prioritizes latency without a price-sort override", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PROVIDER_STRATEGY, "latency");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PROVIDER_SORT, "");
});
