/**
 * Deterministic memory retrieval regression (Phase 1 eval scaffolding).
 * Simulates a crowded note store + BM25-style ranking without live embeddings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";

test("BM25: rare token surfaces correct note among 50 distractors (10 query variants)", () => {
  const rare = "zzquixnote9alpha";
  const docs: RankableDoc[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < 50; i++) {
    docs.push({
      id: `fact:noise_${i}`,
      text: `fact:noise_${i} filler corpus token${i} lorem ipsum dolor sit amet`,
      memoryType: "fact",
      updatedAt: now,
    });
  }
  docs.push({
    id: "fact:mission_codeword",
    text: `fact:mission_codeword The mission codeword is ${rare} for alpha team extraction.`,
    memoryType: "fact",
    updatedAt: now,
  });

  const queries = [
    rare,
    `${rare} mission`,
    `alpha ${rare}`,
    `codeword is ${rare}`,
    `team extraction ${rare}`,
    `${rare} codeword`,
    `mission codeword ${rare}`,
    `${rare} for alpha`,
    `extraction ${rare} team`,
    `${rare} zzquix`,
  ];

  for (const q of queries) {
    const ranked = rankDocumentsForQuery(q, docs, { limit: 8 });
    const ids = ranked.map((r) => r.id);
    assert.ok(
      ids.includes("fact:mission_codeword"),
      `query "${q}" — top-8 was [${ids.join(", ")}]`
    );
    assert.equal(ranked[0]?.id, "fact:mission_codeword", `query "${q}" — expected top hit`);
  }
});
