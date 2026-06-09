import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_USER_VISIBLE_REPLY_CHARS,
  needsUserReplyFinalization,
} from "./user_reply_guard.js";

test("does not finalize when assistant reply is substantive", () => {
  assert.equal(
    needsUserReplyFinalization({
      assistantText: "x".repeat(MIN_USER_VISIBLE_REPLY_CHARS),
      toolsUsed: ["web_search", "web_fetch"],
      intent: "research",
    }),
    false
  );
});

test("finalizes research turn with web tools but empty chat", () => {
  assert.equal(
    needsUserReplyFinalization({
      assistantText: "",
      toolsUsed: ["web_search", "web_fetch"],
      intent: "research",
    }),
    true
  );
});

test("finalizes when vault ran but chat is only a stub", () => {
  assert.equal(
    needsUserReplyFinalization({
      assistantText: "Saved to vault.",
      toolsUsed: ["web_search", "vault_write"],
      intent: "research",
    }),
    true
  );
});

test("skips opening turns", () => {
  assert.equal(
    needsUserReplyFinalization({
      assistantText: "",
      toolsUsed: ["web_search"],
      intent: "research",
      openingTurn: true,
    }),
    false
  );
});
