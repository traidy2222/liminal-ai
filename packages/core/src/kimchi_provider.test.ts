import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  formatKimchiProviderError,
  isKimchiApiBaseUrl,
  isKimchiRetryableProviderError,
  isKimchiThrottleError,
  KIMCHI_API_BASE_URL,
  parseKimchiRateLimitRetryAfterMs,
  resolveKimchiMinIntervalMs,
} from "./kimchi_provider.js";

test("isKimchiApiBaseUrl recognizes Cast AI endpoint", () => {
  assert.equal(isKimchiApiBaseUrl(KIMCHI_API_BASE_URL), true);
  assert.equal(isKimchiApiBaseUrl("https://openrouter.ai/api/v1"), false);
});

test("isKimchiRetryableProviderError retries opaque HTTP 400", () => {
  const err = new OpenAI.APIError(400, undefined, "400 status code (no body)", {});
  assert.equal(isKimchiRetryableProviderError(err), true);
});

test("isKimchiRetryableProviderError skips invalid model errors", () => {
  const err = new OpenAI.APIError(
    400,
    { error: { message: "unknown model minimax-m2.7" } },
    "bad request",
    {}
  );
  assert.equal(isKimchiRetryableProviderError(err), false);
});

test("parseKimchiRateLimitRetryAfterMs reads rate limited until timestamp", () => {
  const future = new Date(Date.now() + 5_000).toISOString();
  const err = new OpenAI.APIError(
    429,
    { error: `minimax-m2.7 model is rate limited until ${future}` },
    "rate limited",
    {}
  );
  const ms = parseKimchiRateLimitRetryAfterMs(err);
  assert.ok(ms != null && ms >= 4_000 && ms <= 6_000);
});

test("isKimchiThrottleError is true for Kimchi base + 429", () => {
  const err = new OpenAI.RateLimitError(429, undefined, "429", {});
  assert.equal(isKimchiThrottleError(err, KIMCHI_API_BASE_URL), true);
  assert.equal(isKimchiThrottleError(err, "https://openrouter.ai/api/v1"), false);
});

test("resolveKimchiMinIntervalMs defaults to 1500", () => {
  assert.equal(resolveKimchiMinIntervalMs(), 1_500);
});

test("formatKimchiProviderError explains HTTP 401", () => {
  const err = new OpenAI.APIError(401, { error: "Unauthorized" }, "401", {});
  const msg = formatKimchiProviderError(err);
  assert.ok(msg?.includes("401"));
  assert.ok(msg?.includes("KIMCHI_API_KEY"));
});
