import test from "node:test";
import assert from "node:assert/strict";
import {
  isExhaustedProviderRoutingError,
  isExhaustedProviderRoutingMessage,
  parseOpenRouterProviderSlug,
} from "./openrouter_errors.js";

test("parseOpenRouterProviderSlug extracts provider from JSON metadata", () => {
  const err = new Error(
    '429 {"error":{"message":"temporarily rate-limited upstream","metadata":{"provider_name":"DeepInfra"}}}'
  );
  assert.equal(parseOpenRouterProviderSlug(err), "DeepInfra");
});

test("parseOpenRouterProviderSlug extracts provider from prose", () => {
  const err = new Error("Provider DeepInfra is temporarily rate-limited upstream. Please retry shortly.");
  assert.equal(parseOpenRouterProviderSlug(err), "DeepInfra");
});

test("parseOpenRouterProviderSlug returns null when unknown", () => {
  assert.equal(parseOpenRouterProviderSlug(new Error("network error")), null);
});

test("isExhaustedProviderRoutingMessage detects ignore exhaustion", () => {
  assert.equal(
    isExhaustedProviderRoutingMessage('404 {"error":{"message":"All providers have been ignored."}}'),
    true
  );
  assert.equal(
    isExhaustedProviderRoutingMessage("No allowed providers are available for the selected model."),
    true
  );
  assert.equal(isExhaustedProviderRoutingMessage("rate limited"), false);
});

test("isExhaustedProviderRoutingError wraps message helper", () => {
  assert.equal(
    isExhaustedProviderRoutingError(new Error("All providers have been ignored")),
    true
  );
});
