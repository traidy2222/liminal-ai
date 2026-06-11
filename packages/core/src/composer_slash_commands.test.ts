import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySlashCompletion,
  detectSlashInput,
  listSlashCompletions,
  parseComposerSlashSubmit,
  resolveSlashCommandDef,
} from "./composer_slash_commands.js";

test("resolveSlashCommandDef resolves aliases", () => {
  assert.equal(resolveSlashCommandDef("receipts")?.kind, "receipt_workflow");
  assert.equal(resolveSlashCommandDef("status")?.kind, "integrations_status");
  assert.equal(resolveSlashCommandDef("nope"), null);
});

test("listSlashCompletions suggests commands and providers", () => {
  const connectItems = listSlashCompletions("/con", 4);
  assert.ok(connectItems.some((i) => i.label === "/connect"));

  const xeroItems = listSlashCompletions("/connect xe", 10);
  assert.ok(xeroItems.some((i) => i.label === "xero"));
});

test("applySlashCompletion inserts command with trailing space", () => {
  const { text, cursor } = applySlashCompletion("/con", 4, {
    label: "/connect",
    insert: "connect",
    kind: "command",
  });
  assert.equal(text, "/connect ");
  assert.equal(cursor, text.length);
});

test("parseComposerSlashSubmit parses connect flags", () => {
  const parsed = parseComposerSlashSubmit("/connect xero --read-only");
  assert.equal(parsed?.kind, "connect");
  assert.deepEqual(parsed?.args, ["xero"]);
  assert.equal(parsed?.readOnly, true);
});

test("parseComposerSlashSubmit parses receipt note", () => {
  const parsed = parseComposerSlashSubmit("/receipt fuel");
  assert.equal(parsed?.kind, "receipt_workflow");
  assert.equal(parsed?.note, "fuel");
});

test("detectSlashInput is false outside slash line", () => {
  assert.equal(detectSlashInput("hello /con", 8), null);
  assert.ok(detectSlashInput("/connect ", 9));
});

test("parseComposerSlashSubmit strips quotes from attach paths with spaces", () => {
  const parsed = parseComposerSlashSubmit('/attach "C:\\Users\\me\\My Receipts\\scan.png"');
  assert.equal(parsed?.kind, "attach");
  assert.deepEqual(parsed?.args, ["C:\\Users\\me\\My Receipts\\scan.png"]);
});
