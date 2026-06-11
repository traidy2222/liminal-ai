import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyImplicitFollowUpFeedback,
  resolveInputShortcut,
} from "./input_semantics.js";

test("resolveInputShortcut sends on Enter when allowed", () => {
  assert.equal(
    resolveInputShortcut({ key: "Enter" }, { canSend: true, busy: false }),
    "send"
  );
});

test("classifyImplicitFollowUpFeedback thanks-but is not bare thanks", () => {
  const fb = classifyImplicitFollowUpFeedback("thanks but can you also add tests");
  assert.notEqual(fb.kind, "thanks");
});
