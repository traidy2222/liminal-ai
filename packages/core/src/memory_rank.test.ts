import test from "node:test";
import assert from "node:assert/strict";
import { rankDocumentsForQuery } from "./memory_rank.js";

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
