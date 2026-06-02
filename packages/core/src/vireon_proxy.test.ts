import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  parseVireonUpstreamRetryCount,
  vireonProxyAlreadyRetriedUpstream,
} from "./vireon_proxy.js";

test("parseVireonUpstreamRetryCount reads proxy retry header", () => {
  const err = new OpenAI.APIError(429, undefined, "busy", {
    "x-vireon-upstream-retries": "3",
  });
  assert.equal(parseVireonUpstreamRetryCount(err), 3);
  assert.equal(vireonProxyAlreadyRetriedUpstream(err), true);
});

test("parseVireonUpstreamRetryCount returns 0 when header missing", () => {
  const err = new OpenAI.APIError(429, undefined, "busy", undefined);
  assert.equal(parseVireonUpstreamRetryCount(err), 0);
  assert.equal(vireonProxyAlreadyRetriedUpstream(err), false);
});
