import assert from "node:assert/strict";
import test from "node:test";
import {
  buildToolIntentDedupKey,
  evaluateIntentPayloadComplete,
  intentDedupReuseOutput,
  buildIntentProgressBlock,
} from "./tool_intent_dedup.js";

test("buildToolIntentDedupKey ignores undeclared payload fields", () => {
  const fields = ["to", "subject"];
  const a = JSON.stringify({
    to: ["devrel@fireworks.ai"],
    subject: "Hello",
    body_html: "<p>A</p>",
  });
  const b = JSON.stringify({
    to: ["devrel@fireworks.ai"],
    subject: "Hello",
    body_html: "<p>B longer</p>",
  });
  assert.equal(buildToolIntentDedupKey("gmail_create_draft", a, fields), buildToolIntentDedupKey("gmail_create_draft", b, fields));
});

test("buildToolIntentDedupKey falls back to full args without intent fields", () => {
  const a = JSON.stringify({ path: "x.ts", content: "a" });
  const b = JSON.stringify({ path: "x.ts", content: "b" });
  assert.notEqual(buildToolIntentDedupKey("write_file", a, undefined), buildToolIntentDedupKey("write_file", b, undefined));
});

test("evaluateIntentPayloadComplete defaults true without hook", () => {
  assert.equal(evaluateIntentPayloadComplete(undefined, "{}", "ok"), true);
});

test("evaluateIntentPayloadComplete uses tool hook", () => {
  const complete = evaluateIntentPayloadComplete(
    (args) => typeof args["body_html"] === "string" && args["body_html"].length > 10,
    JSON.stringify({ body_html: "<table><tr><td style='padding:24px'>x</td></tr></table>" }),
    "draftId=abc"
  );
  assert.equal(complete, true);
  const incomplete = evaluateIntentPayloadComplete(
    (args) => typeof args["body_html"] === "string" && args["body_html"].length > 10,
    JSON.stringify({ body_html: "short" }),
    "draftId=abc"
  );
  assert.equal(incomplete, false);
});

test("intentDedupReuseOutput is tool-agnostic", () => {
  const out = intentDedupReuseOutput({
    toolName: "some_tool",
    intentKey: "some_tool:a|b",
    output: "ok result",
    summary: "some_tool (a=1, b=2)",
    payloadComplete: true,
  });
  assert.match(out, /some_tool/);
  assert.match(out, /next step/i);
});

test("buildIntentProgressBlock lists completed intents", () => {
  const block = buildIntentProgressBlock([
    {
      toolName: "gmail_create_draft",
      intentKey: "k1",
      output: "",
      summary: "gmail_create_draft (to=a@b.com, subject=hi)",
      payloadComplete: true,
    },
  ]);
  assert.match(block, /TOOL PROGRESS/);
  assert.match(block, /next step/i);
});
