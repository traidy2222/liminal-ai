/**
 * Hybrid recall: BM25 (always) + optional cosine over indexed note embeddings.
 */
import { defineTool } from "./helpers.js";
import { loadNotes, loadRawNotes, bumpNoteMetadata, getNoteValue, type StoredNote } from "./notes_store.js";
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

export const recallRelevantTool = defineTool({
  name: "recall_relevant",
  description:
    "WHAT: Ranked retrieval across session notes + vault for a natural-language query.\n" +
    "Uses BM25 + recency + type; when AGENT_EMBED_MODEL is set, adds semantic similarity on notes.\n" +
    "WHEN: Starting work on a topic, or when search_memory / vault_search feel too literal.\n" +
    "ARGS: query — natural language; k — max hits per source (default 8); scope — notes | vault | both.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to retrieve" },
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
    const query = (args["query"] as string).trim();
    const k = Math.min(30, Math.max(1, (args["k"] as number | undefined) ?? 8));
    const scope = (args["scope"] as string | undefined) ?? "both";
    if (!query) return { ok: false, error: "query must be non-empty" };

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

      const bmRanked = rankDocumentsForQuery(query, docs, { limit: k * 4 });
      const bmNorms = normBm25Scores(bmRanked.map((x) => x.score));
      const bmById = new Map<string, number>();
      bmRanked.forEach((r, i) => bmById.set(r.id, bmNorms[i] ?? 0));

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
          const { vectors } = await fetchEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            inputs: [query.slice(0, 8000)],
          });
          const qv = vectors[0]!;
          for (const { key, score } of embedQueryAgainstIndex(qv, idx, k * 4)) {
            semById.set(key, score);
          }
        } catch {
          /* embeddings optional */
        }
      }

      const allIds = new Set<string>([...bmById.keys(), ...semById.keys()]);
      const fused: Array<{ id: string; score: number; value: string }> = [];
      for (const id of allIds) {
        const bm = bmById.get(id) ?? 0;
        const sem = semById.get(id) ?? 0;
        const hybrid = 0.55 * sem + 0.35 * bm + 0.1 * Math.max(sem, bm);
        if (hybrid < 0.02) continue;
        fused.push({ id, score: hybrid, value: plain[id] ?? "" });
      }
      fused.sort((a, b) => b.score - a.score);
      const top = fused.slice(0, k);
      if (top.length === 0) {
        lines.push("(no note matches)");
      } else {
        lines.push("## Notes");
        for (const t of top) {
          lines.push(
            `- [${t.id}] score=${t.score.toFixed(3)} — ${t.value.slice(0, 200)}${t.value.length > 200 ? "…" : ""}`
          );
          bumpKeys.push(t.id);
        }
      }
    }

    if (scope === "vault" || scope === "both") {
      const vhits = await searchVault(query, {});
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
