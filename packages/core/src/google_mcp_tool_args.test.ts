import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceMcpInteger,
  normalizeDriveMcpQuery,
  normalizeGoogleMcpToolArgs,
  pruneMcpArgsToRemoteSchema,
} from "./google_mcp_tool_args.js";

test("coerceMcpInteger truncates floats and parses strings", () => {
  assert.equal(coerceMcpInteger(25.7), 25);
  assert.equal(coerceMcpInteger("10"), 10);
});

test("normalizeDriveMcpQuery upgrades bare dates in Drive query", () => {
  const q = normalizeDriveMcpQuery("modifiedTime > '2024-06-05'");
  assert.match(q, /2024-06-05T00:00:00Z/);
});

test("normalizeGoogleMcpToolArgs fixes drive search query dates", () => {
  const out = normalizeGoogleMcpToolArgs(
    "mcp_google_drive_search_files",
    { query: "modifiedTime > '2024-04-05'" },
    { type: "object", properties: { query: { type: "string" } } }
  );
  assert.match(String(out.query), /2024-04-05T00:00:00Z/);
});

test("normalizeGoogleMcpToolArgs maps page_size to pageSize without duplicate keys", () => {
  const schema = {
    type: "object" as const,
    properties: {
      pageSize: { type: "number" as const },
      page_size: { type: "number" as const },
    },
  };
  const out = normalizeGoogleMcpToolArgs(
    "mcp_google_drive_list_recent_files",
    { page_size: "25" },
    schema
  );
  assert.equal(out.pageSize, 25);
  assert.equal("page_size" in out, false);
});

test("normalizeGoogleMcpToolArgs does not inject calendarId on list_calendars", () => {
  const schema = {
    type: "object" as const,
    properties: {
      pageSize: { type: "number" as const },
      pageToken: { type: "string" as const },
    },
  };
  const out = normalizeGoogleMcpToolArgs("mcp_google_calendar_list_calendars", {}, schema);
  assert.equal("calendarId" in out, false);
});

test("pruneMcpArgsToRemoteSchema drops hallucinated fields", () => {
  const remote = { pageSize: { type: "integer" }, pageToken: { type: "string" } };
  const out = pruneMcpArgsToRemoteSchema(remote, {
    pageSize: 25,
    limit: 10,
    time_max: "2024-06-06",
    query: "test",
  });
  assert.deepEqual(out, { pageSize: 25 });
});
