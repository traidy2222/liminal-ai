import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeEntity,
  parseEntityNote,
  renderEntityNote,
  entityNoteTypeFor,
  type ExtractedEntity,
  noteTypeFromKindTags,
} from "./vault_entity_merge.js";

test("create a fresh entity note from extraction", () => {
  const e: ExtractedEntity = {
    name: "Ali Khamenei",
    kind: "person",
    summary: "Supreme Leader of Iran",
    current: "Publicly raged at US House war-powers vote",
    relationships: ["Mojtaba Khamenei", "Hezbollah"],
  };
  const { body, changed } = mergeEntity(null, e, "2026-06-05");
  assert.equal(changed, true);
  assert.ok(body.includes("## Identity\nSupreme Leader of Iran"));
  assert.ok(body.includes("## Current\n- 2026-06-05: Publicly raged"));
  assert.ok(body.includes("- [[Mojtaba Khamenei]]"));
  assert.ok(body.includes("- [[Hezbollah]]"));
});

test("merge demotes old current to history and adds new current", () => {
  const existing = mergeEntity(
    null,
    { name: "Ali Khamenei", kind: "person", summary: "Supreme Leader", current: "Suspended mediator comms" },
    "2026-06-01"
  ).body;

  const { body, changed } = mergeEntity(
    existing,
    { name: "Ali Khamenei", kind: "person", summary: "Supreme Leader", current: "Rejected ceasefire deal" },
    "2026-06-05"
  );
  assert.equal(changed, true);
  // newest current on top
  assert.ok(/## Current\n- 2026-06-05: Rejected ceasefire deal/.test(body));
  // old current rolled into history
  assert.ok(/## History[\s\S]*2026-06-01: Suspended mediator comms/.test(body));
});

test("identity is not clobbered; relationships union; self-link dropped", () => {
  const existing = renderEntityNote({
    identity: "Curated identity line",
    current: [],
    history: [],
    relationships: ["Iran"],
  });
  const { body } = mergeEntity(
    existing,
    {
      name: "Hezbollah",
      kind: "org",
      summary: "Different summary that should NOT overwrite",
      relationships: ["Lebanon", "Hezbollah", "Iran"], // self + dup
    },
    "2026-06-05"
  );
  assert.ok(body.includes("## Identity\nCurated identity line"));
  assert.ok(body.includes("- [[Iran]]"));
  assert.ok(body.includes("- [[Lebanon]]"));
  assert.ok(!body.includes("- [[Hezbollah]]")); // self dropped
});

test("re-ingesting the same current fact is a no-op (idempotent)", () => {
  const e: ExtractedEntity = { name: "X", kind: "concept", summary: "s", current: "doing the thing" };
  const first = mergeEntity(null, e, "2026-06-05");
  const second = mergeEntity(first.body, e, "2026-06-06");
  assert.equal(second.changed, false);
  // not duplicated into history
  assert.equal((second.body.match(/doing the thing/g) ?? []).length, 1);
});

test("parse round-trips a converted plain note into identity", () => {
  const s = parseEntityNote("Just a paragraph about something.");
  assert.equal(s.identity, "Just a paragraph about something.");
  assert.deepEqual(s.current, []);
});

test("noteTypeFromKindTags prefers event/concept over entity", () => {
  assert.equal(noteTypeFromKindTags(["entity", "event", "liminal-agent"]), "episode");
  assert.equal(noteTypeFromKindTags(["concept", "liminal-agent"]), "concept");
  assert.equal(noteTypeFromKindTags(["entity", "person", "liminal-agent"]), "entity");
});

test("entityNoteTypeFor maps kinds to vault type folders", () => {
  assert.equal(entityNoteTypeFor("event"), "episode");
  assert.equal(entityNoteTypeFor("concept"), "concept");
  assert.equal(entityNoteTypeFor("person"), "entity");
  assert.equal(entityNoteTypeFor("org"), "entity");
  assert.equal(entityNoteTypeFor("place"), "entity");
});
