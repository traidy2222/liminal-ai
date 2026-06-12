import test from "node:test";
import assert from "node:assert/strict";
import {
  batchHasUndispatchableEmailCompose,
  sanitizeToolCallArgsForContext,
  tryRepairEmailComposeArgsJson,
} from "./email_compose_resume.js";
import type { AccumulatedToolCall } from "./types.js";

test("tryRepairEmailComposeArgsJson rebuilds truncated gmail_create_draft", () => {
  const broken =
    '{"to":["founder@console.dev"],"subject":"Liminal — local AI agent","body_html":"<p>Hi there</p><p>We built';
  const repaired = tryRepairEmailComposeArgsJson(broken, "gmail_create_draft");
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as Record<string, unknown>;
  assert.deepEqual(parsed.to, ["founder@console.dev"]);
  assert.equal(parsed.subject, "Liminal — local AI agent");
  assert.match(String(parsed.body_html), /^<p>Hi there<\/p>/);
});

test("sanitizeToolCallArgsForContext replaces invalid JSON with {}", () => {
  assert.equal(sanitizeToolCallArgsForContext('{"to":["a@b.com"'), "{}");
  assert.equal(sanitizeToolCallArgsForContext('{"to":["a@b.com"]}'), '{"to":["a@b.com"]}');
});

test("batchHasUndispatchableEmailCompose flags invalid compose args", () => {
  const tc: AccumulatedToolCall = {
    id: "c1",
    name: "gmail_create_draft",
    argsJson: '{"to":["x@y.com"],"subject":"Hi","body_html":"<p>open',
  };
  assert.equal(batchHasUndispatchableEmailCompose([tc], "length"), true);
});
