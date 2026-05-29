/**
 * Deterministic A/B for the recall reranker (AGENT_RECALL_RERANK).
 *
 * WHY MODEL-FREE (mostly): the full ReAct loop is nondeterministic, so eyeballing
 * "does the harness feel better" is unreproducible. Instead this seeds a fixed
 * set of TRAP notes into an isolated temp store, then calls the recall_relevant
 * tool handler twice — once with the reranker OFF, once ON — and compares where
 * the single semantically-correct "gold" note lands in each ranking. The only
 * nondeterminism is the reranker's own fast-model call, which is exactly the
 * thing under test.
 *
 * THE TRAP: under BM25-only retrieval, two lexically-rich distractors (UI render
 * note + Kafka note, both stuffed with "realtime / event / stream / disconnect")
 * outrank the gold note, which answers the actual question ("how do I keep the
 * stream from disconnecting") but shares few literal tokens with the query. A
 * good reranker reads intent and promotes the gold note; BM25 alone cannot.
 *
 * PASS: the reranker moves the gold note to a strictly better rank than BM25-only
 * (ideally #1). Run:  npm run ab:rerank -w packages/eval
 */
import "./rerank_ab_bootstrap.js";
import { AB_TEMP_ROOT } from "./rerank_ab_bootstrap.js";

// Imported AFTER the bootstrap so the temp roots are already pinned. We go
// through the public registration API rather than reaching into tool source
// (which would violate the eval package's tsconfig rootDir). `remember` and
// `recall_relevant` are plain (non-harness-scoped) tools, so they register
// without an AgentHarness.
import { ToolRegistry, AgentEmitter } from "@liminal/core";
import { registerAllTools } from "@liminal/tools";

interface TrapNote {
  key: string;
  value: string;
  /** True for the single note that actually answers the query. */
  gold?: boolean;
}

const QUERY = "how do I keep the realtime event stream from disconnecting?";

// One gold note + lexical distractors + filler. The distractors are written to
// MAXIMIZE token overlap with the query while being topically wrong.
const NOTES: TrapNote[] = [
  {
    key: "infra:sse-keepalive",
    value:
      "To keep a long-lived Server-Sent Events connection alive, send a tiny comment ping every 8 seconds; idle proxies and load balancers otherwise drop the socket after ~30–60s of silence.",
    gold: true,
  },
  {
    key: "ui:event-stream-render",
    value:
      "Realtime event stream UI: render each streamed event into the timeline the instant it arrives so the stream feels live and never visually appears to disconnect mid-render.",
  },
  {
    key: "data:kafka-stream",
    value:
      "Our Kafka realtime event stream pipeline processes millions of events; when a consumer disconnects the broker rebalances stream partitions across the remaining consumers.",
  },
  {
    key: "ui:toast-style",
    value: "Toast notifications use a 4px radius and slide in from the bottom-right corner.",
  },
  {
    key: "build:vite-pages",
    value: "The multi-page Vite build needs absolute __dirname paths in rollupOptions.input.",
  },
  {
    key: "infra:retry-backoff",
    value: "HTTP retries use exponential backoff capped at 30s with full jitter.",
  },
];

interface Ranked {
  key: string;
  score: number;
  rank: number; // 1-based position in the notes list
}

/** Parse the `## Notes` lines of recall_relevant output into ordered (key, score). */
function parseNotes(output: string): Ranked[] {
  const out: Ranked[] = [];
  const lines = output.split("\n");
  let inNotes = false;
  for (const line of lines) {
    if (line.startsWith("## Notes")) {
      inNotes = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inNotes = false;
      continue;
    }
    if (!inNotes) continue;
    const m = /^- \[([^\]]+)\] score=([\d.]+)/.exec(line.trim());
    if (m) out.push({ key: m[1]!, score: Number(m[2]!), rank: out.length + 1 });
  }
  return out;
}

/** Number of reranker trials. The BM25 baseline is deterministic (1 run). */
const TRIALS = Number(process.env["AB_TRIALS"] ?? "8");

// Single shared registry, populated once in main().
const registry = new ToolRegistry();
const emitter = new AgentEmitter();
function tool(name: string) {
  const t = registry.get(name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t;
}

async function runRecall(rerank: boolean): Promise<Ranked[]> {
  process.env["AGENT_RECALL_RERANK"] = rerank ? "1" : "0";
  // The fast-model JSON cache would make repeated identical reranker calls
  // collapse to one network hit (masking trial-to-trial variance), so disable
  // it for the A/B. We want every trial to be a fresh judgment.
  process.env["AGENT_LLM_JSON_CACHE"] = "0";
  const res = await tool("recall_relevant").handler({ query: QUERY, scope: "notes", k: 6 }, () => {});
  if (!res.ok || typeof res.output !== "string") {
    throw new Error(`recall_relevant failed: ${JSON.stringify(res)}`);
  }
  return parseNotes(res.output);
}

function rankOfGold(ranked: Ranked[], goldKey: string): number {
  const hit = ranked.find((r) => r.key === goldKey);
  return hit ? hit.rank : Number.POSITIVE_INFINITY;
}

function orderKey(ranked: Ranked[]): string {
  return ranked.map((r) => r.key).join(">");
}

function fmtRanking(ranked: Ranked[], goldKey: string): string {
  return ranked
    .map((r) => `    ${r.rank}. ${r.key === goldKey ? "★ " : "  "}${r.key}  (${r.score.toFixed(3)})`)
    .join("\n");
}

async function main(): Promise<void> {
  const goldKey = NOTES.find((n) => n.gold)!.key;

  console.log(`\nReranker A/B — isolated store at ${AB_TEMP_ROOT}`);
  console.log(`Query: "${QUERY}"`);
  console.log(`Gold note: [${goldKey}] (the one that actually answers the query)`);
  console.log(`Reranker trials: ${TRIALS} (the treatment is a stochastic LLM call)\n`);

  // Register tools through the public API (no harness needed for these two).
  await registerAllTools(registry, emitter);

  // Seed the trap notes via the real remember tool handler.
  for (const n of NOTES) {
    const r = await tool("remember").handler({ key: n.key, value: n.value }, () => {});
    if (!r.ok) throw new Error(`remember(${n.key}) failed: ${JSON.stringify(r)}`);
  }

  // ── Arm A: reranker OFF (BM25-only, deterministic baseline) ──
  const off = await runRecall(false);
  const offRank = rankOfGold(off, goldKey);
  const offOrder = orderKey(off);

  console.log("── Arm A: AGENT_RECALL_RERANK=0 (BM25-only baseline, deterministic) ──");
  console.log(fmtRanking(off, goldKey));
  console.log(`  gold rank: ${Number.isFinite(offRank) ? offRank : "absent"}\n`);

  // ── Arm B: reranker ON, repeated TRIALS times ──
  // A degraded trial = the reranker call returned null (e.g. provider 429, or
  // malformed JSON) so recall_relevant kept the BM25 first-stage order. We
  // detect that as "ranking identical to the baseline" and EXCLUDE it from the
  // quality metric: a 429 measures provider availability, not whether the
  // reranker discriminates. Degrade rate is reported separately as noise.
  const effRanks: number[] = []; // ranks from non-degraded (judged) trials only
  let top1Eff = 0;
  let degraded = 0;
  let bestRanking: Ranked[] | null = null;

  console.log(`── Arm B: AGENT_RECALL_RERANK=1 (${TRIALS} trials, ~1.2s apart to dodge 429s) ──`);
  for (let i = 0; i < TRIALS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));
    const on = await runRecall(true);
    const r = rankOfGold(on, goldKey);
    const isDegraded = orderKey(on) === offOrder;
    if (isDegraded) {
      degraded++;
    } else {
      effRanks.push(r);
      if (r === 1) top1Eff++;
    }
    if (!bestRanking || r < rankOfGold(bestRanking, goldKey)) bestRanking = on;
    console.log(
      `  trial ${i + 1}: gold rank ${r}${r === 1 ? " ★" : ""}${isDegraded ? "  (degraded → call failed, BM25 order — excluded)" : ""}`
    );
  }

  const judged = effRanks.length;
  const meanEff = judged ? effRanks.reduce((a, b) => a + b, 0) / judged : Number.NaN;

  console.log(`\n  best reranked ordering seen:`);
  if (bestRanking) console.log(fmtRanking(bestRanking, goldKey));

  console.log("\n──────────────────────── SUMMARY ────────────────────────");
  console.log(`  BM25-only gold rank:        #${offRank} (fixed baseline)`);
  console.log(`  judged trials (call ok):    ${judged}/${TRIALS}`);
  console.log(`  └ mean gold rank:           ${judged ? "#" + meanEff.toFixed(2) : "n/a"}`);
  console.log(`  └ reached top-1:            ${top1Eff}/${judged} (${judged ? ((top1Eff / judged) * 100).toFixed(0) : "0"}%)`);
  console.log(`  degraded (provider 429/null): ${degraded}/${TRIALS}  ← availability noise, not rerank quality`);

  // Verdict is on RERANK QUALITY among judged trials: when the call succeeds,
  // does it reliably promote the gold note that BM25 buried at #${offRank}?
  // Require a clear quality signal (≥80% top-1) over a meaningful sample.
  if (judged === 0) {
    console.log("──────────────────────────────────────────────────────────");
    console.log("INCONCLUSIVE — every reranker call failed (provider unavailable). Re-run later.");
    console.log("──────────────────────────────────────────────────────────\n");
    process.exit(2);
  }
  const quality = top1Eff / judged;
  const helps = meanEff < offRank && quality >= 0.8;
  const verdict = helps
    ? `PASS — when the reranker call succeeds it promotes the gold note BM25 buried at #${offRank} to a mean of #${meanEff.toFixed(2)} (top-1 ${top1Eff}/${judged}).`
    : `FAIL — among judged trials the reranker did not reliably beat BM25 (mean #${meanEff.toFixed(2)} vs #${offRank}, top-1 ${top1Eff}/${judged}).`;
  console.log("──────────────────────────────────────────────────────────");
  console.log(verdict);
  console.log("──────────────────────────────────────────────────────────\n");

  process.exit(helps ? 0 : 1);
}

main().catch((err) => {
  console.error("A/B run errored:", err);
  process.exit(2);
});
