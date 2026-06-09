import assert from "node:assert/strict";
import { test } from "node:test";
import { officeRestEnabled } from "./google_office_rest.js";
import { createGoogleOfficeRestTools } from "./google_office_rest.js";

test("officeRestEnabled defaults on when env unset", () => {
  const prev = process.env.AGENT_GOOGLE_OFFICE_REST;
  delete process.env.AGENT_GOOGLE_OFFICE_REST;
  try {
    assert.equal(officeRestEnabled(), true);
  } finally {
    if (prev !== undefined) process.env.AGENT_GOOGLE_OFFICE_REST = prev;
    else delete process.env.AGENT_GOOGLE_OFFICE_REST;
  }
});

test("officeRestEnabled respects AGENT_GOOGLE_OFFICE_REST=0", () => {
  const prev = process.env.AGENT_GOOGLE_OFFICE_REST;
  process.env.AGENT_GOOGLE_OFFICE_REST = "0";
  try {
    assert.equal(officeRestEnabled(), false);
  } finally {
    if (prev !== undefined) process.env.AGENT_GOOGLE_OFFICE_REST = prev;
    else delete process.env.AGENT_GOOGLE_OFFICE_REST;
  }
});

test("createGoogleOfficeRestTools registers docs, sheets, slides, and export", () => {
  const names = createGoogleOfficeRestTools().map((t) => t.name);
  assert.ok(names.includes("docs_rest_get_document"));
  assert.ok(names.includes("sheets_rest_get_values"));
  assert.ok(names.includes("slides_rest_batch_update"));
  assert.ok(names.includes("office_rest_export_file"));
  assert.ok(names.includes("docs_rest_write_blocks"));
  assert.ok(names.includes("docs_rest_insert_table"));
  assert.ok(names.includes("docs_rest_set_document_style"));
  assert.ok(names.includes("sheets_rest_auto_fit"));
  assert.equal(names.length, 28);
});
