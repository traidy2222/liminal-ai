import assert from "node:assert/strict";
import { test } from "node:test";
import { createGmailSendTools } from "./google_gmail_send.js";

test("gmail REST tools include create, send_draft, and send_message", () => {
  const tools = createGmailSendTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ["gmail_create_draft", "gmail_send_draft", "gmail_send_message"]);
});

test("gmail_send_draft requires draft_id", () => {
  const tool = createGmailSendTools().find((t) => t.name === "gmail_send_draft")!;
  const req = (tool.parameters as { required?: string[] }).required ?? [];
  assert.ok(req.includes("draft_id"));
  assert.equal(tool.requiresApproval, true);
});
