import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tryHeuristicInboxTriage } from "./heuristics.js";
import type { InboxMessageMeta } from "./types.js";

function msg(overrides: Partial<InboxMessageMeta> = {}): InboxMessageMeta {
  return {
    id: "m1",
    provider: "gmail",
    accountId: "acct",
    from: "Alice",
    fromEmail: "alice@example.com",
    subject: "Hello",
    snippet: "Hi there",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("inbox_watcher heuristics", () => {
  it("detects newsletter via List-Unsubscribe", () => {
    const v = tryHeuristicInboxTriage(msg({ listUnsubscribe: true }), {
      vipSenders: [],
      newsletterDomains: [],
      denyDomains: [],
    });
    assert.equal(v?.category, "newsletter");
  });

  it("detects VIP sender", () => {
    const v = tryHeuristicInboxTriage(msg({ fromEmail: "boss@corp.com" }), {
      vipSenders: ["boss@corp.com"],
      newsletterDomains: [],
      denyDomains: [],
    });
    assert.equal(v?.category, "urgent");
    assert.equal(v?.needsReply, true);
  });

  it("detects noreply automated mail", () => {
    const v = tryHeuristicInboxTriage(
      msg({ fromEmail: "noreply@stripe.com", from: "Stripe" }),
      { vipSenders: [], newsletterDomains: [], denyDomains: [] }
    );
    assert.equal(v?.category, "automated");
  });
});
