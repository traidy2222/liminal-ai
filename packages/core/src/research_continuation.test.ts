import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResearchContinuationNudge,
  isActiveResearchSend,
  needsResearchContinuation,
  researchCoverageLooksThin,
} from "./research_continuation.js";

test("researchCoverageLooksThin detects many pending URLs", () => {
  assert.equal(
    researchCoverageLooksThin({
      searchCount: 2,
      uniqueQueryCount: 2,
      urlInventoryCount: 8,
      fetchedOk: 1,
      fetchedFail: 0,
      pending: 5,
    }),
    true
  );
});

test("needsResearchContinuation blocks thin single-search coverage", () => {
  const gate = needsResearchContinuation({
    userMessage: "what is going on with the iran situation",
    intent: "research",
    toolsUsed: ["web_search", "web_fetch"],
    summary: {
      searchCount: 1,
      uniqueQueryCount: 1,
      urlInventoryCount: 5,
      fetchedOk: 1,
      fetchedFail: 0,
      pending: 4,
    },
    pendingUrlSamples: ["https://example.com/a", "https://example.com/b"],
    gateAttempted: false,
  });
  assert.equal(gate.needed, true);
  if (gate.needed) {
    assert.match(gate.message, /RESEARCH CONTINUATION/);
    assert.match(gate.message, /example\.com\/a/);
  }
});

test("needsResearchContinuation skips brief asks", () => {
  const gate = needsResearchContinuation({
    userMessage: "quick tldr on hydrogen",
    intent: "research",
    toolsUsed: ["web_search"],
    summary: {
      searchCount: 1,
      uniqueQueryCount: 1,
      urlInventoryCount: 5,
      fetchedOk: 0,
      fetchedFail: 0,
      pending: 5,
    },
    gateAttempted: false,
  });
  assert.equal(gate.needed, false);
});

test("isActiveResearchSend includes freshness-sensitive knowledge", () => {
  assert.equal(
    isActiveResearchSend({
      intent: "knowledge",
      freshnessSensitive: true,
      userMessage: "update me on the latest",
    }),
    true
  );
});

test("buildResearchContinuationNudge mentions parallel fetch", () => {
  const msg = buildResearchContinuationNudge({
    summary: {
      searchCount: 1,
      uniqueQueryCount: 1,
      urlInventoryCount: 4,
      fetchedOk: 1,
      fetchedFail: 0,
      pending: 3,
    },
    pendingSample: ["https://reuters.com/x"],
  });
  assert.match(msg, /parallel/i);
  assert.match(msg, /reuters\.com/);
});
