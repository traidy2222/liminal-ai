import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReceiptWorkflowTurnInjection,
  isReceiptWorkflowTurn,
  parseReceiptSlashCommand,
  RECEIPT_WORKFLOW_PRESET,
  resolveReceiptWorkflowUserMessage,
  stripReceiptWorkflowCommandPrefix,
} from "./receipt_workflow.js";

test("parseReceiptSlashCommand accepts receipt aliases", () => {
  assert.deepEqual(parseReceiptSlashCommand("/receipt fuel"), { note: "fuel" });
  assert.deepEqual(parseReceiptSlashCommand("/receipts"), { note: "" });
  assert.deepEqual(parseReceiptSlashCommand("/process-receipts office supplies"), {
    note: "office supplies",
  });
  assert.equal(parseReceiptSlashCommand("/connect xero"), null);
});

test("isReceiptWorkflowTurn requires images", () => {
  assert.equal(
    isReceiptWorkflowTurn({
      workflowPreset: RECEIPT_WORKFLOW_PRESET,
      userMessage: "",
      imageAttachmentCount: 1,
    }),
    true
  );
  assert.equal(
    isReceiptWorkflowTurn({
      workflowPreset: RECEIPT_WORKFLOW_PRESET,
      userMessage: "",
      imageAttachmentCount: 0,
    }),
    false
  );
  assert.equal(
    isReceiptWorkflowTurn({
      userMessage: "/receipt fuel",
      imageAttachmentCount: 1,
    }),
    true
  );
});

test("stripReceiptWorkflowCommandPrefix resolves default message", () => {
  assert.equal(stripReceiptWorkflowCommandPrefix("/receipts"), resolveReceiptWorkflowUserMessage(""));
  assert.equal(stripReceiptWorkflowCommandPrefix("/receipt fuel"), "fuel");
});

test("buildReceiptWorkflowTurnInjection includes recipe steps and attachments", () => {
  const injection = buildReceiptWorkflowTurnInjection({
    userNote: "fuel receipt",
    attachments: [
      {
        name: "mobil.jpg",
        mimeType: "image/jpeg",
        filePath: "C:\\ws\\.agent_artifacts\\uploads\\1-mobil.jpg",
        sizeBytes: 1200,
        source: "clipboard",
      },
    ],
  });
  assert.match(injection, /xero_duplicate_invoice_check/);
  assert.match(injection, /xero_upload_attachment/);
  assert.match(injection, /xero_create_bill/);
  assert.match(injection, /fuel receipt/);
  assert.match(injection, /mobil\.jpg/);
});
