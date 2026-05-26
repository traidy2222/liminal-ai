#!/usr/bin/env node
// End-to-end smoke test: mine real session JSONLs and report results.
// Usage: node scripts/paste_smoke.mjs
import {
  minePatternsFromSessions,
  savePatternStore,
  loadPatternStore,
  buildContextKey,
  queryPatterns,
  patternStorePath,
} from "../packages/core/dist/index.js";

const t0 = Date.now();
const patterns = await minePatternsFromSessions({ contextWindow: 2, minSupport: 2 });
console.log(`mined ${patterns.length} pattern(s) in ${Date.now() - t0}ms`);
if (patterns.length === 0) {
  console.log("no patterns met support floor — exiting");
  process.exit(0);
}

console.log("\nTop 8 by probability:");
for (const p of patterns.slice(0, 8)) {
  console.log(
    `  ${p.contextKey.padEnd(40)} → ${p.nextTool.padEnd(20)} p=${p.probability.toFixed(2)} (n=${p.support}, hits=${p.hits})`
  );
}

const saved = await savePatternStore(patterns);
console.log(`\nwrote pattern store: ${saved}`);

const store = await loadPatternStore();
if (!store) {
  console.error("loadPatternStore returned null after save");
  process.exit(1);
}
console.log(`loaded ${store.count} pattern(s) from ${patternStorePath()}`);

// Probe: what would we predict after web_search,web_search?
const ctx = buildContextKey(["web_search", "web_search"], 2);
const predictions = queryPatterns(store, ctx, { topK: 3 });
console.log(`\nPredictions for context "${ctx}":`);
if (predictions.length === 0) {
  console.log("  (no predictions)");
} else {
  for (const p of predictions) {
    console.log(`  ${p.nextTool}  p=${p.probability.toFixed(2)} (n=${p.support})`);
  }
}

// Also probe the read_file → grep_file family.
const ctx2 = buildContextKey(["read_file", "read_file"], 2);
const predictions2 = queryPatterns(store, ctx2, { topK: 3 });
console.log(`\nPredictions for context "${ctx2}":`);
if (predictions2.length === 0) {
  console.log("  (no predictions)");
} else {
  for (const p of predictions2) {
    console.log(`  ${p.nextTool}  p=${p.probability.toFixed(2)} (n=${p.support})`);
  }
}
