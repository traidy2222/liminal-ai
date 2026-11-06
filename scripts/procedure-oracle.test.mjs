import test from "node:test";
import assert from "node:assert/strict";
import { matchesRequestedRecord } from "./lib/procedure-oracle.mjs";
test("the external oracle checks task values independently of JSON key order", () => {
  const input = { name: "maple", symbol: "Maple" };
  assert(
    matchesRequestedRecord(
      { kind: "provider", symbol: "Maple", name: "maple" },
      input,
    ),
  );
  assert(
    !matchesRequestedRecord(
      { name: "cedar", symbol: "Cedar", kind: "provider" },
      input,
    ),
  );
  assert(
    !matchesRequestedRecord(
      { name: "maple", symbol: "Maple", kind: "component" },
      input,
    ),
  );
  assert(
    !matchesRequestedRecord(
      { name: "maple", symbol: "Maple", kind: "provider", unexpected: true },
      input,
    ),
  );
  assert(!matchesRequestedRecord(null, input));
});
