import test from "node:test";
import assert from "node:assert/strict";
import { isAccountSignupTurn } from "./account_signup.js";
import { applyTurnInferenceHeuristics, neutralTurnInferenceResult } from "./intent_inference.js";

test("account creation routes to execution, not coding, conversation or inbox operations", () => {
  for (const text of ["create me a gmail account", "can u please create your own GitHub account", "sign me up for Notion", "set up a new account on https://example.com"]) {
    assert.equal(isAccountSignupTurn(text), true, text);
    const inference = applyTurnInferenceHeuristics(text, neutralTurnInferenceResult("llm", { intent: "coding", complexity: "trivial", implementShip: true, buildDeliverable: true }));
    assert.equal(inference.intent, "execution"); assert.equal(inference.toolFirstBias, true);
    assert.equal(inference.implementShip, false); assert.equal(inference.buildDeliverable, false);
  }
});
test("does not reinterpret account advice, code changes or unrelated privileged activity as signup", () => {
  for (const text of ["how do I create a Gmail account?", "fix the signup page", "implement account creation", "check my Gmail inbox", "create a bank account", "create 100 spam accounts", "create fake identity accounts to bypass a ban"]) {
    assert.equal(isAccountSignupTurn(text), false, text);
  }
});
