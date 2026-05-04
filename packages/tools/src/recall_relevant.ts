/**
 * Hybrid recall: BM25 (always) + optional cosine over indexed note embeddings.
 * Multi-query RRF when `queries` provided; optional HyDE for semantic vector.
 */
import { defineTool } from "./helpers.js";
import { loadNotes, loadRawNotes, bumpNoteMetadata, type StoredNote } from "./notes_store.js";
import { rankDocumentsForQuery, type RankableDoc, fetchEmbeddings } from "@liminal/core";
import {
  loadEmbedIndex,
  upsertNoteEmbeddings,
  embedQueryAgainstIndex,
} from "./memory_index.js";
import { searchVault } from "./vault_store.js";

function normBm25Scores(scores: number[]): number[] {
  const m = Math.max(...scores, 1e-9);
  return scores.map((s) => s / m);
}

function normMap(m: Map<string, number>): Map<string, number> {
  let mx = 0;
  for (const v of m.values()) mx = Math.max(mx, v);
  if (mx <= 0) return m;
  const out = new Map<string, number>();
  for (const [k, v] of m) out.set(k, v / mx);
  return out;
}

/** Reciprocal rank fusion across ordered id lists. */
function rrfFuse(rankings: string[][], kConst = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankings) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (kConst + idx + 1));
    });
  }
  return scores;
}

export const recallRelevantTool = defineTool({
  name: "recall_relevant",
  description:
    "WHAT: Ranked retrieval across session notes + vault for natural-language (multi-query RRF when `queries` set).\n" +
    "Uses BM25 + recency + type; when AGENT_EMBED_MODEL is set, adds semantic similarity on notes.\n" +
    "WHEN: Starting work on a topic, or when search_memory / vault_search feel too literal.\n" +
    "ARGS: query — single query (optional if queries set); queries — array of sub-queries; hyde — optional hypothetical passage for embedding only; k; scope.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Single retrieval query" },
      queries: {
        type: "array",
        items: { type: "string" },
        description: "Multiple sub-queries (RRF fusion); overrides single query when non-empty",
      },
      hyde: {
        type: "string",
        description: "Hypothetical answer text for semantic embedding only (optional)",
      },
      k: { type: "number", description: "Max results per source (default 8, max 30)" },
      scope: {
        type: "string",
        enum: ["notes", "vault", "both"],
        description: "Where to search (default both)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const k = Math.min(30, Math.max(1, (args["k"] as number | undefined) ?? 8));
    const scope = (args["scope"] as string | undefined) ?? "both";
    const hyde = typeof args["hyde"] === "string" ? args["hyde"].trim().slice(0, 2000) : "";
    const qArr = args["queries"] as string[] | undefined;
    const single = (args["query"] as string | undefined)?.trim() ?? "";
    const queries: string[] =
      Array.isArray(qArr) && qArr.length > 0
        ? qArr.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
        : single
          ? [single]
          : [];
    if (queries.length === 0) return { ok: false, error: "query or queries required" };

    const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
    const baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      ""
    );
    const embedModel = process.env["AGENT_EMBED_MODEL"]?.trim();

    const lines: string[] = [];
    const bumpKeys: string[] = [];

    if (scope === "notes" || scope === "both") {
      const plain = await loadNotes();
      const raw = await loadRawNotes();
      const docs: RankableDoc[] = Object.entries(plain).map(([id, value]) => {
        const rv = raw[id];
        const updatedAt =
          typeof rv === "object" && rv !== null && "updatedAt" in rv
            ? (rv as StoredNote).updatedAt
            : undefined;
        const colon = id.indexOf(":");
        const memoryType = colon > 0 ? id.slice(0, colon) : undefined;
        const accessCount =
          typeof rv === "object" && rv !== null && "accessCount" in rv
            ? (rv as StoredNote).accessCount
            : undefined;
        const confidence =
          typeof rv === "object" && rv !== null && "confidence" in rv
            ? (rv as StoredNote).confidence
            : undefined;
        return {
          id,
          text: `${id} ${value}`,
          updatedAt,
          memoryType,
          accessCount,
          confidence,
        };
      });

      const perQueryRankings: string[][] = [];
      for (const q of queries) {
        const bmRanked = rankDocumentsForQuery(q, docs, { limit: k * 4 });
        perQueryRankings.push(bmRanked.map((x) => x.id));
      }
      const rrfById = normMap(rrfFuse(perQueryRankings));

      const bmById = new Map<string, number>();
      const anchor = queries[0] ?? "";
      const bmRanked0 = rankDocumentsForQuery(anchor, docs, { limit: k * 4 });
      const bmNorms0 = normBm25Scores(bmRanked0.map((x) => x.score));
      bmRanked0.forEach((r, i) => bmById.set(r.id, bmNorms0[i] ?? 0));

      const semById = new Map<string, number>();
      if (embedModel && apiKey) {
        try {
          await upsertNoteEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            notes: plain,
          });
          const idx = await loadEmbedIndex();
          const embedText = (hyde || queries.join(" | ")).slice(0, 8000);
          const { vectors } = await fetchEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            inputs: [embedText],
          });
          const qv = vectors[0]!;
          for (const { key, score } of embedQueryAgainstIndex(qv, idx, k * 4)) {
            semById.set(key, score);
          }
        } catch {
          /* embeddings optional */
        }
      }

      const semN = normMap(semById);
      const fused: Array<{ id: string; score: number; value: string }> = [];
      const allIds = new Set<string>([...rrfById.keys(), ...semN.keys(), ...bmById.keys()]);
      for (const id of allIds) {
        const rrf = rrfById.get(id) ?? 0;
        const bm = bmById.get(id) ?? 0;
        const sem = semN.get(id) ?? 0;
        const hybrid = 0.45 * sem + 0.35 * rrf + 0.2 * bm;
        if (hybrid < 0.008) continue;
        fused.push({ id, score: hybrid, value: plain[id] ?? "" });
      }
      fused.sort((a, b) => b.score - a.score);

      let top = fused.slice(0, k);

      if (process.env["AGENT_MEMORY_GRAPH"] === "1" && top.length > 0) {
        const extra = new Map<string, { id: string; score: number; value: string }>();
        const floor = top.length > 0 ? top[top.length - 1]!.score * 0.35 : 0;
        for (const t of top.slice(0, Math.min(6, top.length))) {
          const rv = raw[t.id];
          if (!rv || typeof rv === "string") continue;
          const links = (rv as StoredNote).links ?? [];
          for (const lk of links) {
            if (!plain[lk] || extra.has(lk)) continue;
            extra.set(lk, {
              id: lk,
              score: floor,
              value: plain[lk] ?? "",
            });
          }
        }
        top = [...top, ...[...extra.values()].filter((x) => !top.some((y) => y.id === x.id))].slice(
          0,
          k + 6
        );
      }

      if (top.length === 0) {
        lines.push("(no note matches)");
      } else {
        lines.push("## Notes");
        for (const t of top.slice(0, k + 4)) {
          lines.push(
            `- [${t.id}] score=${t.score.toFixed(3)} — ${t.value.slice(0, 200)}${t.value.length > 200 ? "…" : ""}`
          );
          bumpKeys.push(t.id);
        }
      }
    }

    if (scope === "vault" || scope === "both") {
      const vq = queries.join(" ");
      const vhits = await searchVault(vq, {});
      lines.push("## Vault");
      if (vhits.length === 0) lines.push("(no vault matches)");
      else {
        for (const h of vhits.slice(0, k)) {
          lines.push(
            `- [[${h.note.title}]] (${h.note.type}) — ${h.snippet.replace(/\s+/g, " ").slice(0, 180)}`
          );
        }
      }
    }

    void bumpNoteMetadata(bumpKeys);
    return { ok: true, output: lines.join("\n") };
  },
});
