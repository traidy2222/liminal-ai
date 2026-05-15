import { defineTool } from "./helpers.js";
import { loadRawNotes, getNoteValue, bumpNoteMetadata, type StoredNote } from "./notes_store.js";
import { rankDocumentsForQuery, type RankableDoc } from "@liminal/core";

export const searchMemoryTool = defineTool({
  name: "search_memory",
  description:
    "WHAT: Ranked search across stored note keys AND values (BM25-lite + recency + type).\n" +
    "WHEN: You need to find a note but don't know the exact key, or want to discover what was stored about a topic.\n" +
    "NOT WHEN: You already know the exact key — use recall instead.\n" +
    "ARGS: query — text to match; type — optional filter: fact, experience, entity, belief, reflection, recipe, hypothesis; limit — max results (default 40).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to match in keys and values" },
      type: {
        type: "string",
        description: "Optional: filter to only this memory type (fact, experience, entity, belief, reflection, recipe, hypothesis)",
      },
      limit: {
        type: "number",
        description: "Max results to return (default 40, max 200)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const query = (args["query"] as string).trim();
    const typeFilter = args["type"] as string | undefined;
    const limit = Math.min(200, Math.max(1, (args["limit"] as number | undefined) ?? 40));

    if (!query) {
      return { ok: false, error: "query must be non-empty" };
    }

    const raw = await loadRawNotes();
    const docs: RankableDoc[] = [];

    for (const [k, v] of Object.entries(raw)) {
      if (typeFilter && !k.startsWith(`${typeFilter}:`)) continue;
      const plain = getNoteValue(v);
      const updatedAt =
        typeof v === "object" && v !== null && "updatedAt" in v
          ? (v as StoredNote).updatedAt
          : undefined;
      const colon = k.indexOf(":");
      const memoryType = colon > 0 ? k.slice(0, colon) : undefined;
      const accessCount =
        typeof v === "object" && v !== null && "accessCount" in v
          ? (v as StoredNote).accessCount
          : undefined;
      const confidence =
        typeof v === "object" && v !== null && "confidence" in v
          ? (v as StoredNote).confidence
          : undefined;
      docs.push({
        id: k,
        text: `${k} ${plain}`,
        updatedAt,
        memoryType,
        accessCount,
        confidence,
      });
    }

    const ranked = rankDocumentsForQuery(query, docs, { limit });
    if (ranked.length === 0) {
      const qLower = query.toLowerCase();
      const fallback = Object.entries(raw).filter(([k, v]) => {
        if (typeFilter && !k.startsWith(`${typeFilter}:`)) return false;
        const plain = getNoteValue(v);
        return k.toLowerCase().includes(qLower) || plain.toLowerCase().includes(qLower);
      });
      if (fallback.length === 0) {
        return {
          ok: true,
          output: typeFilter ? `(no matches in ${typeFilter} memories)` : "(no matches)",
        };
      }
      const out = fallback
        .slice(0, limit)
        .map(([k, v]) => `${k}: ${getNoteValue(v)}`)
        .join("\n");
      return { ok: true, output: out };
    }

    const out = ranked
      .map((r) => {
        const plain = getNoteValue(raw[r.id]!);
        return `${r.id}: ${plain}`;
      })
      .join("\n");
    void bumpNoteMetadata(ranked.map((r) => r.id));
    return { ok: true, output: out };
  },
});
