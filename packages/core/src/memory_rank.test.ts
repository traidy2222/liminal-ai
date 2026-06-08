import test from "node:test";
import assert from "node:assert/strict";
import {
  rankDocumentsForQuery,
  parseRecalledNoteBlocks,
  detectContradictions,
} from "./memory_rank.js";

test("rankDocumentsForQuery prefers matching terms + fact type", () => {
  const docs = [
    { id: "a", text: "fact:foo unrelated text", memoryType: "fact", updatedAt: new Date().toISOString() },
    { id: "b", text: "entity:bar liminal monorepo typescript", memoryType: "entity", updatedAt: new Date().toISOString() },
    { id: "c", text: "fact:baz liminal monorepo details", memoryType: "fact", updatedAt: new Date().toISOString() },
  ];
  const r = rankDocumentsForQuery("liminal monorepo", docs, { limit: 5 });
  assert.ok(r.length >= 1);
  assert.equal(r[0]!.id, "c");
});

test("parseRecalledNoteBlocks parses multi-block recall output", () => {
  const output =
    "## Notes\n- [task:alpha] score=0.91 — first\n---\n## Notes\n- [task:beta] score=0.88 — second";
  const notes = parseRecalledNoteBlocks(output);
  assert.equal(notes.length, 2);
  assert.equal(notes[0]!.key, "task:alpha");
  assert.equal(notes[1]!.key, "task:beta");
});

test("detectContradictions attaches noteKey when recall lines are parsed", () => {
  const recalled = parseRecalledNoteBlocks(
    "## Notes\n- [fact:port] score=0.95 — API server port is 8080"
  );
  const hits = detectContradictions(recalled, ["health check passed for API server on port 3001"]);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]!.noteKey, "fact:port");
});
