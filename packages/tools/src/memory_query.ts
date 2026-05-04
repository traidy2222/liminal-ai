/**
 * Unified memory retrieval (recall / recall_type / search_memory / recall_relevant / memory_graph).
 */
import { defineTool } from "./helpers.js";
import {
  loadNotes,
  loadRawNotes,
  bumpNoteMetadata,
  getNoteValue,
  type StoredNote,
} from "./notes_store.js";
import { rankDocumentsForQuery, type RankableDoc } from "@liminal/core";
import { recallRelevantTool } from "./recall_relevant.js";
import { memoryGraphTool } from "./memory_graph.js";

const MEMORY_TYPES = ["fact", "experience", "entity", "belief", "reflection", "recipe"] as const;

type Mode = "exact" | "type" | "lexical" | "hybrid" | "graph";

function rerankLines(
  lines: string[],
  goalHint: string,
  openQuestions: string[]
): string[] {
  const q = [goalHint, ...openQuestions].join("\n").trim();
  if (!q || lines.length === 0) return lines;
  const docs: RankableDoc[] = lines.map((text, i) => ({
    id: String(i),
    text: text.slice(0, 1500),
  }));
  const ranked = rankDocumentsForQuery(q, docs, { limit: lines.length });
  return ranked.map((r) => lines[parseInt(r.id, 10)]!).filter(Boolean);
}

export const memoryQueryTool = defineTool({
  name: "memory_query",
  description:
    "WHAT: Unified memory + vault retrieval.\n" +
    "WHEN: Any time you need notes — prefer this over calling recall + search_memory separately.\n" +
    "MODES: exact (by key), type (all of a category), lexical (BM25 on notes), hybrid (notes+vault BM25/RRF/embed), graph (BFS links from seed).\n" +
    "ARGS: mode; query/key/seed per mode; goal_hint + open_questions rerank hits against your plan.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["exact", "type", "lexical", "hybrid", "graph"],
        description: "Retrieval mode",
      },
      key: { type: "string", description: "exact: note key" },
      memory_type: {
        type: "string",
        description: `type: one of ${MEMORY_TYPES.join(", ")}`,
      },
      query: { type: "string", description: "lexical / hybrid: search query" },
      queries: {
        type: "array",
        items: { type: "string" },
        description: "hybrid: optional multi-query RRF",
      },
      hyde: { type: "string", description: "hybrid: optional HyDE text" },
      k: { type: "number", description: "hybrid: max hits (default 8)" },
      scope: {
        type: "string",
        enum: ["notes", "vault", "both"],
        description: "hybrid: where to search",
      },
      seed: { type: "string", description: "graph: starting note key" },
      depth: { type: "number", description: "graph: BFS depth" },
      limit: { type: "number", description: "graph / lexical: max rows" },
      type_filter: {
        type: "string",
        description: "lexical: optional memory type prefix filter",
      },
      goal_hint: { type: "string", description: "Rerank: current goal text" },
      open_questions: {
        type: "array",
        items: { type: "string" },
        description: "Rerank: active sub-questions",
      },
    },
    required: ["mode"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const mode = args["mode"] as Mode;
    const goalHint = String(args["goal_hint"] ?? "").trim();
    const openQs = Array.isArray(args["open_questions"])
      ? (args["open_questions"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];

    const formatHit = (source: string, score: number, snippet: string) =>
      JSON.stringify({
        source,
        score: Math.round(score * 1000) / 1000,
        snippet: snippet.slice(0, 280),
      });

    try {
      if (mode === "graph") {
        const r = await memoryGraphTool.handler(args);
        if (!r.ok) return r;
        const lines = String(r.output).split("\n").filter(Boolean);
        const rr = rerankLines(lines, goalHint, openQs);
        return {
          ok: true,
          output: `mode=graph\n${rr.join("\n")}`,
        };
      }

      if (mode === "hybrid") {
        const q = (args["query"] as string | undefined)?.trim() ?? "";
        const qArr = args["queries"] as string[] | undefined;
        const queries = Array.isArray(qArr) && qArr.length > 0 ? qArr : q ? [q] : [];
        if (queries.length === 0) {
          return { ok: false, error: "hybrid mode requires query or queries" };
        }
        const payload: Record<string, unknown> = {
          query: queries[0]!,
          queries,
          k: (args["k"] as number | undefined) ?? 8,
          scope: (args["scope"] as string | undefined) ?? "both",
        };
        if (typeof args["hyde"] === "string" && args["hyde"].trim()) {
          payload["hyde"] = args["hyde"].trim().slice(0, 2000);
        }
        const r = await recallRelevantTool.handler(payload);
        if (!r.ok) return r;
        const lines = String(r.output).split("\n").filter(Boolean);
        const rr = rerankLines(lines, goalHint, openQs);
        const jsonl = rr.slice(0, 24).map((ln, i) => formatHit(`hybrid:${i}`, 1 - i * 0.01, ln));
        return { ok: true, output: `mode=hybrid\n${jsonl.join("\n")}` };
      }

      if (mode === "exact") {
        const notes = await loadNotes();
        if (args["key"]) {
          const key = args["key"] as string;
          const val = notes[key];
          if (val !== undefined) void bumpNoteMetadata([key]);
          return val !== undefined
            ? {
                ok: true,
                output: `${formatHit(`note:${key}`, 1, val)}\n${val}`,
              }
            : { ok: false, error: `No note for key "${key}"` };
        }
        const keys = Object.keys(notes);
        return {
          ok: true,
          output: keys.length > 0 ? keys.join(", ") : "(no notes)",
        };
      }

      if (mode === "type") {
        const memType = args["memory_type"] as string;
        if (!memType || !(MEMORY_TYPES as readonly string[]).includes(memType)) {
          return { ok: false, error: `memory_type must be one of: ${MEMORY_TYPES.join(", ")}` };
        }
        const prefix = `${memType}:`;
        const notes = await loadNotes();
        const lines = Object.entries(notes)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => `${k}: ${v}`);
        const rr = rerankLines(lines, goalHint, openQs);
        const jsonl = rr.map((ln, i) => formatHit(`type:${memType}:${i}`, 1 - i * 0.01, ln));
        return {
          ok: true,
          output: `mode=type\n${jsonl.join("\n")}\n---\n${rr.join("\n\n")}`,
        };
      }

      if (mode === "lexical") {
        const query = String(args["query"] ?? "").trim();
        const typeFilter = args["type_filter"] as string | undefined;
        const limit = Math.min(200, Math.max(1, (args["limit"] as number | undefined) ?? 40));
        if (!query) return { ok: false, error: "lexical mode requires query" };

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
        void bumpNoteMetadata(ranked.map((r) => r.id));
        const lines = ranked.map((r) => {
          const plain = getNoteValue(raw[r.id]!);
          return `${r.id}: ${plain}`;
        });
        const rr = rerankLines(lines, goalHint, openQs).slice(0, limit);
        const jsonl = rr.map((ln) => {
          const id = ln.split(":")[0] ?? "note";
          return formatHit(id, 1, ln);
        });
        return {
          ok: true,
          output: `mode=lexical\n${jsonl.join("\n")}\n---\n${rr.join("\n")}`,
        };
      }

      return { ok: false, error: `Unknown mode: ${String(mode)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
