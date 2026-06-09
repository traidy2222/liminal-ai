import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceSheetsValues,
  normalizeGoogleRestToolArgs,
  toRfc3339DateTime,
  validateGoogleRestToolArgs,
} from "./google_rest_tool_args.js";

test("toRfc3339DateTime appends midnight Z for date-only", () => {
  assert.equal(toRfc3339DateTime("2024-06-05"), "2024-06-05T00:00:00Z");
});

test("coerceSheetsValues wraps flat row into 2D array", () => {
  assert.deepEqual(coerceSheetsValues(["a", "b"]), [["a", "b"]]);
});

test("normalizeGoogleRestToolArgs coerces values JSON string", () => {
  const out = normalizeGoogleRestToolArgs("sheets_rest_update_values", {
    spreadsheet_id: "abc",
    range: "A1:B1",
    values: '[["x","y"]]',
  });
  assert.deepEqual(out.values, [["x", "y"]]);
});

test("normalizeGoogleRestToolArgs maps timeMin alias", () => {
  const out = normalizeGoogleRestToolArgs("calendar_rest_freebusy", {
    time_min: "2024-06-05",
    time_max: "2024-06-06",
  });
  assert.equal(out.time_min, "2024-06-05T00:00:00Z");
});

test("normalizeGoogleRestToolArgs maps documentId to document_id", () => {
  const out = normalizeGoogleRestToolArgs("docs_rest_write_blocks", {
    documentId: "abc123",
    blocks: "[]",
  });
  assert.equal(out.document_id, "abc123");
  assert.deepEqual(out.blocks, []);
});

test("validateGoogleRestToolArgs rejects missing document_id", () => {
  const err = validateGoogleRestToolArgs("docs_rest_batch_update", { requests: [] });
  assert.ok(err?.includes("document_id"));
});

test("normalizeGoogleRestToolArgs coerces sheets batch_update requests JSON string", () => {
  const out = normalizeGoogleRestToolArgs("sheets_rest_batch_update", {
    spreadsheet_id: "abc",
    requests: '[{"addSheet":{"properties":{"title":"Sheet2"}}}]',
  });
  assert.ok(Array.isArray(out.requests));
  assert.equal((out.requests as unknown[]).length, 1);
});

test("normalizeGoogleRestToolArgs coerces sheets batch_update_values data JSON string", () => {
  const out = normalizeGoogleRestToolArgs("sheets_rest_batch_update_values", {
    spreadsheet_id: "abc",
    data: '[{"range":"A1:B1","values":[["x","y"]]}]',
  });
  assert.ok(Array.isArray(out.data));
  assert.equal((out.data as unknown[]).length, 1);
});

test("validateGoogleRestToolArgs rejects non-array sheets requests", () => {
  const err = validateGoogleRestToolArgs("sheets_rest_batch_update", {
    spreadsheet_id: "abc",
    requests: "not-json",
  });
  assert.ok(err?.includes("requests must be an array"));
});
