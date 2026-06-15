import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isEmailComposeTurn,
  isEmailStyleFieldGroundedInUserMessage,
  isOutreachResearchTurn,
  sanitizeEmailStyleInferInput,
} from "./email_compose_context.js";

test("isEmailComposeTurn detects send-email asks", () => {
  assert.equal(isEmailComposeTurn("can u send a email to cod4v4@gmail.com about our tool system?"), true);
  assert.equal(isEmailComposeTurn("fix the bug in auth.ts"), false);
});

test("isOutreachResearchTurn detects youtuber email hunts", () => {
  assert.equal(
    isOutreachResearchTurn("Find some youtubers emails that might be interested in liminal"),
    true
  );
  assert.equal(isOutreachResearchTurn("fix auth.ts"), false);
});

test("sanitizeEmailStyleInferInput drops ungrounded industry", () => {
  const user = "send an email about our tool system to cod4v4@gmail.com";
  const out = sanitizeEmailStyleInferInput(
    {
      purpose: "Introduce Liminal tool system",
      industry: "healthcare",
      brand_context: "hospital operations director",
      background: "from recipe hint about hospitals",
    },
    user
  );
  assert.equal(out.industry, undefined);
  assert.equal(out.brand_context, undefined);
  assert.equal(out.background, undefined);
  assert.equal(out.purpose, "Introduce Liminal tool system");
});

test("sanitizeEmailStyleInferInput keeps user-stated industry", () => {
  const user = "send a healthcare clinical email to the hospital CMO";
  const out = sanitizeEmailStyleInferInput(
    { purpose: "Clinical update", industry: "healthcare" },
    user
  );
  assert.equal(out.industry, "healthcare");
});

test("isEmailStyleFieldGroundedInUserMessage", () => {
  assert.equal(isEmailStyleFieldGroundedInUserMessage("healthcare", "email about healthcare ops"), true);
  assert.equal(isEmailStyleFieldGroundedInUserMessage("healthcare", "email about our tool system"), false);
});
