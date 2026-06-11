import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutlookSendTools } from "./outlook_send.js";

test("outlook_send registers send, send_draft, and create_draft tools", () => {
  const tools = createOutlookSendTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("outlook_send_message"));
  assert.ok(names.includes("outlook_send_draft"));
  assert.ok(names.includes("outlook_create_draft"));
});

test("outlook_send_message requires to and subject", () => {
  const send = createOutlookSendTools().find((t) => t.name === "outlook_send_message")!;
  const req = (send.parameters as { required?: string[] }).required ?? [];
  assert.ok(req.includes("to"));
  assert.ok(req.includes("subject"));
});
