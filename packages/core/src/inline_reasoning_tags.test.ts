import test from "node:test";
import assert from "node:assert/strict";

import {
  InlineReasoningTagStreamParser,
  stripInlineReasoningTags,
} from "./inline_reasoning_tags.js";

const THINK_OPEN = `<${"think"}>`;
const THINK_CLOSE = `</${"think"}>`;
const REDACTED_OPEN = `<${"redacted_reasoning"}>`;
const REDACTED_CLOSE = `</${"redacted_reasoning"}>`;

test("stripInlineReasoningTags removes think blocks", () => {
  const raw = `${THINK_OPEN}internal chain${THINK_CLOSE}\n\nHello user.`;
  assert.equal(stripInlineReasoningTags(raw), "Hello user.");
});

test("stripInlineReasoningTags removes redacted_reasoning blocks", () => {
  const raw = `${REDACTED_OPEN}step one${REDACTED_CLOSE}Answer.`;
  assert.equal(stripInlineReasoningTags(raw), "Answer.");
});

test("stream parser splits think tags across chunks", () => {
  const parser = new InlineReasoningTagStreamParser();
  const a = parser.ingest(`Before ${THINK_OPEN}rea`);
  const b = parser.ingest(`soning${THINK_CLOSE} After`);
  const c = parser.flush();

  assert.equal(a.userDelta, "Before ");
  assert.equal(a.reasoningDelta, "rea");
  assert.equal(b.reasoningDelta, "soning");
  assert.equal(b.userDelta, " After");
  assert.equal(c.userDelta, "");
  assert.equal(c.reasoningDelta, "");
});

test("stream parser handles minimax-style multiple think blocks", () => {
  const parser = new InlineReasoningTagStreamParser();
  const chunks = [
    `${THINK_OPEN}first thought${THINK_CLOSE}`,
    `${THINK_OPEN}second thought${THINK_CLOSE}`,
    "Visible reply.",
  ];
  let user = "";
  let reasoning = "";
  for (const chunk of chunks) {
    const out = parser.ingest(chunk);
    user += out.userDelta;
    reasoning += out.reasoningDelta;
  }
  const tail = parser.flush();
  user += tail.userDelta;
  reasoning += tail.reasoningDelta;

  assert.equal(reasoning, "first thoughtsecond thought");
  assert.equal(user, "Visible reply.");
});
