import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatTitleTranscriptExcerpt,
  chatTitleRefreshEligible,
  countUserTurns,
  normalizeGeneratedChatTitle,
  shouldRefreshTitleAtTurn,
} from "./chat_title_refresh_logic.js";
import type { ReplayTranscriptEntry } from "./chat_session_replay.js";

test("shouldRefreshTitleAtTurn milestones", () => {
  const everyTwo = { minUserTurns: 1, everyNTurns: 2 };
  assert.equal(shouldRefreshTitleAtTurn(0, everyTwo), false);
  assert.equal(shouldRefreshTitleAtTurn(1, everyTwo), true);
  assert.equal(shouldRefreshTitleAtTurn(2, everyTwo), false);
  assert.equal(shouldRefreshTitleAtTurn(3, everyTwo), true);

  const everyOne = { minUserTurns: 1, everyNTurns: 1 };
  assert.equal(shouldRefreshTitleAtTurn(2, everyOne), true);
});

test("countUserTurns ignores empty user lines", () => {
  const entries: ReplayTranscriptEntry[] = [
    { id: "1", kind: "user", turnIndex: 0, text: "hello" },
    { id: "2", kind: "user", turnIndex: 1, text: "   " },
    { id: "3", kind: "assistant", turnIndex: 1, text: "hi" },
  ];
  assert.equal(countUserTurns(entries), 1);
});

test("buildChatTitleTranscriptExcerpt keeps recent lines within budget", () => {
  const entries: ReplayTranscriptEntry[] = [
    { id: "1", kind: "user", turnIndex: 0, text: "old message" },
    { id: "2", kind: "assistant", turnIndex: 0, text: "old reply" },
    { id: "3", kind: "user", turnIndex: 1, text: "new message about invoices" },
  ];
  const excerpt = buildChatTitleTranscriptExcerpt(entries, 40);
  assert.match(excerpt, /invoices/);
  assert.ok(!excerpt.includes("old message"));
});

test("normalizeGeneratedChatTitle accepts string or JSON object", () => {
  assert.equal(normalizeGeneratedChatTitle("Fix checkout bug"), "Fix checkout bug");
  assert.equal(normalizeGeneratedChatTitle({ title: "SEO pass for blog" }), "SEO pass for blog");
  assert.equal(normalizeGeneratedChatTitle({ title: "x" }), null);
});

test("chatTitleRefreshEligible skips orchestrator and user-locked titles", () => {
  assert.equal(chatTitleRefreshEligible({ kind: "orchestrator" }), false);
  assert.equal(chatTitleRefreshEligible({ titleSource: "user" }), false);
  assert.equal(chatTitleRefreshEligible({ title: "[Worker] scrape" }), false);
  assert.equal(chatTitleRefreshEligible({ title: "New chat" }), true);
});
