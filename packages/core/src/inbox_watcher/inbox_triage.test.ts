import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInboxTriagePayload } from "./inbox_triage.js";

describe("inbox_triage parse", () => {
  it("parses valid LLM payload", () => {
    const p = parseInboxTriagePayload({
      category: "action",
      confidence: 0.88,
      summary: "Client needs quote",
      suggestedLabel: "Liminal/Review",
      reason: "Direct question",
    });
    assert.ok(p);
    assert.equal(p?.category, "action");
    assert.equal(p?.confidence, 0.88);
  });

  it("rejects unknown category", () => {
    assert.equal(parseInboxTriagePayload({ category: "weird" }), null);
  });
});
