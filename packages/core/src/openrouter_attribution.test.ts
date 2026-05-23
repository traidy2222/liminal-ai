import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOpenRouterAttributionHeaders,
  DEFAULT_OPENROUTER_HTTP_REFERER,
} from "./openrouter_attribution.js";

test("buildOpenRouterAttributionHeaders uses harness repo referer", () => {
  const h = buildOpenRouterAttributionHeaders();
  assert.equal(h["HTTP-Referer"], DEFAULT_OPENROUTER_HTTP_REFERER);
  assert.equal(h["HTTP-Referer"], "https://github.com/traidy2222/liminal-ai");
  assert.equal(h["X-Title"], "Liminal");
});

test("buildOpenRouterAttributionHeaders appends sidecar suffix", () => {
  const h = buildOpenRouterAttributionHeaders("vision-sidecar");
  assert.equal(h["X-Title"], "Liminal-vision-sidecar");
});
