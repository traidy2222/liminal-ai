import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLinearIdentifier } from "./linear_resolve.js";

test("parseLinearIdentifier parses TEAM-123", () => {
  assert.deepEqual(parseLinearIdentifier("ENG-42"), { teamKey: "ENG", number: 42 });
  assert.deepEqual(parseLinearIdentifier("eng-7"), { teamKey: "ENG", number: 7 });
});

test("parseLinearIdentifier rejects non-identifiers", () => {
  assert.equal(parseLinearIdentifier("uuid-here"), null);
  assert.equal(parseLinearIdentifier(""), null);
});
