import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareToolArgsForValidation } from "./tool_dispatch_args.js";
import type { ToolParameterSchema } from "./types.js";

const docsWriteBlocksSchema: ToolParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document_id", "blocks"],
  properties: {
    document_id: { type: "string" },
    blocks: { type: "array", items: { type: "object" } },
  },
};

const docsBatchUpdateSchema: ToolParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document_id", "requests"],
  properties: {
    document_id: { type: "string" },
    requests: { type: "array", items: { type: "object" } },
  },
};

const gmailDraftSchema: ToolParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["to", "subject", "body"],
  properties: {
    to: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    body: { type: "string" },
  },
};

const compressSchema: ToolParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string" },
  },
};

test("prepareToolArgsForValidation maps documentId to document_id", () => {
  const prep = prepareToolArgsForValidation(
    "docs_rest_write_blocks",
    {
      documentId: "doc-123",
      blocks: [{ type: "paragraph", text: "hi" }],
    },
    docsWriteBlocksSchema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.equal(prep.args.document_id, "doc-123");
    assert.ok(Array.isArray(prep.args.blocks));
  }
});

test("prepareToolArgsForValidation coerces requests JSON string to array", () => {
  const prep = prepareToolArgsForValidation(
    "docs_rest_batch_update",
    {
      document_id: "doc-123",
      requests: '[{"insertText":{"location":{"index":1},"text":"Hello"}}]',
    },
    docsBatchUpdateSchema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.ok(Array.isArray(prep.args.requests));
    assert.equal((prep.args.requests as unknown[]).length, 1);
  }
});

const sheetsBatchUpdateSchema: ToolParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spreadsheet_id", "requests"],
  properties: {
    spreadsheet_id: { type: "string" },
    requests: { type: "array", items: { type: "object" } },
  },
};

test("prepareToolArgsForValidation coerces sheets batch_update requests JSON string", () => {
  const prep = prepareToolArgsForValidation(
    "sheets_rest_batch_update",
    {
      spreadsheet_id: "sheet-123",
      requests: '[{"addSheet":{"properties":{"title":"Companies"}}}]',
    },
    sheetsBatchUpdateSchema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.ok(Array.isArray(prep.args.requests));
    assert.equal((prep.args.requests as unknown[]).length, 1);
  }
});

test("prepareToolArgsForValidation prunes hallucinated gmail fields", () => {
  const prep = prepareToolArgsForValidation(
    "gmail_create_draft",
    {
      to: "a@example.com",
      subject: "Test",
      body: "Hello",
      time_max: "2024-06-06",
    },
    gmailDraftSchema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.equal("time_max" in prep.args, false);
    assert.deepEqual(prep.args.to, ["a@example.com"]);
  }
});

test("prepareToolArgsForValidation maps compress_context text to summary", () => {
  const prep = prepareToolArgsForValidation(
    "compress_context",
    { text: "Turn summary here" },
    compressSchema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.equal(prep.args.summary, "Turn summary here");
  }
});

test("prepareToolArgsForValidation strips hallucinated mcp_google fields", () => {
  const schema: ToolParameterSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      pageSize: { type: "number" },
      page_size: { type: "number" },
      pageToken: { type: "string" },
    },
  };
  const prep = prepareToolArgsForValidation(
    "mcp_google_gmail_list_labels",
    { limit: 10, time_max: "2024-06-06", query: "inbox" },
    schema
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.deepEqual(prep.args, { pageSize: 10 });
  }
});
