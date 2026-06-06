import test from "node:test";
import assert from "node:assert/strict";
import {
  isExhaustedProviderRoutingError,
  isExhaustedProviderRoutingMessage,
  isOpenRouterStealthOwlProviderError,
  isOpenRouterUpstreamProviderError,
  isStaleStealthPinMismatch,
  parseOpenRouterProviderMismatch,
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

test("parseOpenRouterProviderMismatch extracts requested vs available providers", () => {
  const err = new Error(
    'HTTP 404 from Error: {"message":"No allowed providers are available for the selected model.","metadata":{"available_providers":["nvidia"],"requested_providers":["stealth"]}}'
  );
  assert.deepEqual(parseOpenRouterProviderMismatch(err), {
    requested: ["stealth"],
    available: ["nvidia"],
  });
  assert.equal(
    isStaleStealthPinMismatch(err, "nvidia/nemotron-3-ultra-550b-a55b:free"),
    true
  );
  assert.equal(isStaleStealthPinMismatch(err, "openrouter/owl-alpha"), false);
});

test("isOpenRouterStealthOwlProviderError matches owl-alpha model slug", () => {
  const err = new Error(
    'HTTP 400 from Error: {"message":"Provider returned error","metadata":{"provider_name":"Stealth"}}'
  );
  assert.equal(isOpenRouterStealthOwlProviderError(err, "openrouter/owl-alpha"), true);
  assert.equal(isOpenRouterStealthOwlProviderError(err, "deepseek/deepseek-v4-pro"), false);
});

test("isOpenRouterUpstreamProviderError detects Stealth opaque 400", () => {
  const err = new Error(
    'HTTP 400 from Error: {"message":"Provider returned error","code":400,"metadata":{"raw":"ERROR","provider_name":"Stealth","is_byok":false}}'
  );
  assert.equal(isOpenRouterUpstreamProviderError(err), true);
});

test("isExhaustedProviderRoutingError wraps message helper", () => {
  assert.equal(
    isExhaustedProviderRoutingError(new Error("All providers have been ignored")),
    true
  );
});
