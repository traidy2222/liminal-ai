import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAndValidateWorkerHandoff,
  parseWorkerHandoff,
  validateWorkerHandoff,
} from "./worker_handoff.js";

const valid = {
  status: "done",
  artifacts: ["src/foo.ts"],
  commandsRun: ["npm test"],
  decisions: ["used edit_file"],
  blockers: [],
  summary: "Implemented foo.",
};

test("validateWorkerHandoff accepts valid done handoff", () => {
  const r = validateWorkerHandoff(valid);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.handoff.status, "done");
});

test("validateWorkerHandoff rejects blocked without blockers", () => {
  const r = validateWorkerHandoff({ ...valid, status: "blocked", blockers: [] });
  assert.equal(r.ok, false);
});

test("validateWorkerHandoff requires summary", () => {
  const r = validateWorkerHandoff({ ...valid, summary: "  " });
  assert.equal(r.ok, false);
});

test("parseWorkerHandoff extracts json fence", () => {
  const text = "Some work.\n\n```json\n" + JSON.stringify(valid) + "\n```";
  const raw = parseWorkerHandoff(text);
  assert.deepEqual(raw, valid);
});

test("parseAndValidateWorkerHandoff fails without json", () => {
  const r = parseAndValidateWorkerHandoff("## Result\nDid stuff.");
  assert.equal(r.ok, false);
});

test("parseAndValidateWorkerHandoff accepts trailing json fence", () => {
  const text = "Brief note.\n```json\n" + JSON.stringify(valid) + "\n```";
  const r = parseAndValidateWorkerHandoff(text);
  assert.equal(r.ok, true);
});
