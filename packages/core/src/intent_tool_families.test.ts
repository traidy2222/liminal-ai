import test from "node:test";
import assert from "node:assert/strict";
import {shouldInjectEmailComposeGuidance} from "./email_compose_context.js";
import { inferIntentToolFamilies } from "./intent_tool_families.js";
import { applyTurnInferenceHeuristics, neutralTurnInferenceResult } from "./intent_inference.js";

test("the text-only performance request keeps the small stable tool surface", () => {
  const message = "For a short response-performance measurement, write about 350 words in plain English explaining what an AI agent harness does, how it uses tools, and how cloud models differ from local models. Answer directly from general knowledge. Do not use tools, browse, write files or run code.";
  const inferred = applyTurnInferenceHeuristics(message, neutralTurnInferenceResult("classifier disabled"));
  assert.equal(inferred.intent, "knowledge");
  assert.deepEqual(inferIntentToolFamilies(inferred.intent, message), []);
});

test("ordinary prose and in-chat recall do not expand the tool catalogue", () => {
  for (const intent of ["knowledge", "introspection", "conversational", "creative"] as const) {
    for (const message of [
      "For this short conversation, remember the label amber. Reply with only: Ready.",
      "What label did I ask you to remember? Reply with that one word.",
      "Repeat that label once more. Reply with that one word.",
      "Explain why leaves change color.",
      "Write a short poem about winter.",
    ]) assert.deepEqual(inferIntentToolFamilies(intent, message), [], `${intent}: ${message}`);
  }
  assert.ok(inferIntentToolFamilies("knowledge", "Search my Gmail inbox").includes("google_mail"));
  assert.ok(inferIntentToolFamilies("research", "Research current energy prices").includes("browser"));
});

test("research uses the browser by default and standalone search/fetch can be restored", () => {
  const before = process.env.AGENT_WEB_SEARCH_FETCH;
  try {
    process.env.AGENT_WEB_SEARCH_FETCH = "0";
    const families = inferIntentToolFamilies("research", "Search the web for current energy prices");
    assert.ok(families.includes("browser")); assert.ok(!families.includes("web"));
    process.env.AGENT_WEB_SEARCH_FETCH = "1";
    assert.ok(inferIntentToolFamilies("research", "Research current energy prices").includes("web"));
  } finally { if (before === undefined) delete process.env.AGENT_WEB_SEARCH_FETCH; else process.env.AGENT_WEB_SEARCH_FETCH = before; }
});
test("browser-only work does not preload cloud catalogs from URLs, workspace paths or quoted content", () => {
  for (const task of [
    "Use Liminal's browser tools for website interaction. Read https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch. The workspace is C:/project/docs/browser-benchmark.",
    "Use the browser to find the latest release at https://github.com/microsoft/playwright/releases. Save in the workspace.",
    'Use the browser to rename "draft email" to "draft agenda" in TodoMVC. The workspace is C:/project/test.',
  ]) {
    const families = inferIntentToolFamilies("execution", task);
    assert.ok(families.includes("browser"));
    assert.ok(
      !families.some((f) => /google|microsoft|github|web$|shell|git$/.test(f)),
      families.join(","),
    );
  }
});
test("specific cloud tasks retain their narrow providers without expanding broad parents", () => {
  const gmail = inferIntentToolFamilies(
    "execution",
    "Send an email using Gmail to the confirmed recipient",
  );
  assert.ok(gmail.includes("google_mail"));
  assert.ok(!gmail.includes("google_workspace"));
  const outlook = inferIntentToolFamilies(
    "execution",
    "Search my Outlook inbox",
  );
  assert.ok(outlook.includes("microsoft_mail"));
  assert.ok(!outlook.includes("microsoft_365"));
});
test("explicit connector use and ordinary coding are still available", () => {
  const mixed = inferIntentToolFamilies(
    "execution",
    "Use Gmail MCP to read the code, then use the browser to complete sign-in",
  );
  assert.ok(mixed.includes("google_mail"));
  const coding = inferIntentToolFamilies(
    "coding",
    "Implement and test the browser automation client",
  );
  assert.ok(coding.includes("shell"));
  assert.ok(coding.includes("git"));
  const negated = inferIntentToolFamilies(
    "execution",
    "Do not use the browser. Use Gmail to read my inbox",
  );
  assert.ok(negated.includes("google_mail"));
});

test("browser editing of an email-labelled task does not activate mail-compose guidance",()=>{
 assert.equal(shouldInjectEmailComposeGuidance('Use the browser to rename "draft email" to "draft agenda" in the task app'),false);
 assert.equal(shouldInjectEmailComposeGuidance('Draft an email in Gmail to the confirmed recipient'),true);
});
