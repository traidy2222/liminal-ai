/**
 * Unified memory retrieval (recall / recall_type / search_memory / recall_relevant / memory_graph).
 */
import { defineTool } from "./helpers.js";
import {
  loadNotes,
  loadRawNotes,
  bumpNoteMetadata,
  getNoteValue,
  getKeyType,
  type StoredNote,
} from "./notes_store.js";
import { rankDocumentsForQuery, type RankableDoc } from "@liminal/core";
import { recallRelevantTool } from "./recall_relevant.js";
import { memoryGraphTool } from "./memory_graph.js";

const MEMORY_TYPES = ["fact", "experience", "entity", "belief", "reflection", "recipe", "hypothesis", "trajectory"] as const;

type Mode = "exact" | "type" | "lexical" | "hybrid" | "graph";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length >= 3)
  );
}

function queryOverlap(a: string, b: string): number {
  const as = tokenize(a);
  const bs = tokenize(b);
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const t of as) if (bs.has(t)) inter += 1;
  return inter / new Set([...as, ...bs]).size;
}

function tierWeight(opts: {
  updatedAt?: string;
  lastAccessedAt?: string;
  confidence: number;
  accessCount: number;
}): number {
  const now = Date.now();
  const updatedMs = opts.updatedAt ? new Date(opts.updatedAt).getTime() : NaN;
  const accessedMs = opts.lastAccessedAt ? new Date(opts.lastAccessedAt).getTime() : NaN;
  const updatedDays = Number.isFinite(updatedMs) ? (now - updatedMs) / 86_400_000 : 9999;
  const accessedDays = Number.isFinite(accessedMs) ? (now - accessedMs) / 86_400_000 : 9999;
  const hot = updatedDays <= 14 && opts.confidence >= 0.7 && (opts.accessCount >= 2 || accessedDays <= 30);
  if (hot) return 1.2;
  const warm = updatedDays <= 120 && opts.confidence >= 0.45;
  if (warm) return 1.0;
  return 0.62;
}

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
    "NOT WHEN: You already have the exact note key and only need one value — use exact mode, not hybrid, to avoid noise.\n" +
    "GOOD OUTPUT: Ranked lines you can merge into an answer; pass goal_hint + open_questions so irrelevant recalled topics do not drown the current ask.\n" +
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
        enum: [...MEMORY_TYPES],
        description: `type mode: memory category (lowercase).`,
      },
      max_results: {
        type: "number",
        description:
          "Optional cap alias: hybrid uses as k when k omitted; lexical/graph use as limit when limit omitted (clamped per mode).",
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
      evidence_gaps: {
        type: "array",
        items: { type: "string" },
        description: "Hybrid mode: explicit missing evidence items for closed-loop retrieval",
      },
      max_refine_rounds: {
        type: "number",
        description: "Hybrid mode: max closed-loop refinement rounds",
      },
      prefer_recent_vault: {
        type: "boolean",
        description: "Hybrid mode: prioritize fresh vault pages and link-neighbor expansion",
      },
      max_age_days: {
        type: "number",
        description: "Optional filter: exclude hits older than this age (days)",
      },
      min_confidence: {
        type: "number",
        description: "Optional filter for notes: minimum confidence (0-1)",
      },
      min_query_overlap: {
        type: "number",
        description: "Optional filter: minimum token-overlap score with query (0-1)",
      },
      exclude_types: {
        type: "array",
        items: { type: "string" },
        description: "Optional note type prefixes to exclude",
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
    const maxAgeDays =
      typeof args["max_age_days"] === "number" && Number.isFinite(args["max_age_days"])
        ? Math.max(1, Math.min(3650, Math.round(args["max_age_days"])))
        : undefined;
    const minConfidence =
      typeof args["min_confidence"] === "number" && Number.isFinite(args["min_confidence"])
        ? Math.max(0, Math.min(1, args["min_confidence"]))
        : undefined;
    const minQueryOverlap =
      typeof args["min_query_overlap"] === "number" && Number.isFinite(args["min_query_overlap"])
        ? Math.max(0, Math.min(1, args["min_query_overlap"]))
        : undefined;
    const excludeTypes = Array.isArray(args["exclude_types"])
      ? new Set((args["exclude_types"] as unknown[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean))
      : new Set<string>();

    const maxResultsRaw = args["max_results"];
    const maxResults =
      typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
        ? Math.max(1, Math.min(200, Math.round(maxResultsRaw)))
        : undefined;

    const formatHit = (source: string, score: number, snippet: string) =>
      JSON.stringify({
        source,
        score: Math.round(score * 1000) / 1000,
        snippet: snippet.slice(0, 280),
      });

    try {
      if (mode === "graph") {
        const graphPayload: Record<string, unknown> = {
          seed: args["seed"],
          depth: args["depth"],
          limit:
            typeof args["limit"] === "number" && Number.isFinite(args["limit"])
              ? args["limit"]
              : maxResults,
        };
        const r = await memoryGraphTool.handler(graphPayload);
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
        const kHybrid =
          typeof args["k"] === "number" && Number.isFinite(args["k"])
            ? Math.max(1, Math.min(30, Math.round(args["k"])))
            : maxResults != null
              ? Math.max(1, Math.min(30, maxResults))
              : 8;
        const payload: Record<string, unknown> = {
          query: queries[0]!,
          queries,
          k: kHybrid,
          scope: (args["scope"] as string | undefined) ?? "both",
        };
        if (typeof args["hyde"] === "string" && args["hyde"].trim()) {
          payload["hyde"] = args["hyde"].trim().slice(0, 2000);
        }
        if (Array.isArray(args["evidence_gaps"])) {
          payload["evidence_gaps"] = args["evidence_gaps"];
        }
        if (typeof args["max_refine_rounds"] === "number") {
          payload["max_refine_rounds"] = args["max_refine_rounds"];
        }
        if (args["prefer_recent_vault"] === true) {
          payload["scope"] = "both";
          payload["expand_vault_neighbors"] = true;
        }
        if (maxAgeDays != null) payload["max_age_days"] = maxAgeDays;
        if (minConfidence != null) payload["min_confidence"] = minConfidence;
        if (minQueryOverlap != null) payload["min_query_overlap"] = minQueryOverlap;
        if (excludeTypes.size > 0) payload["exclude_types"] = [...excludeTypes];
        const r = await recallRelevantTool.handler(payload);
        if (!r.ok) return r;
        const lines = String(r.output).split("\n").filter(Boolean);
        const rr = rerankLines(lines, goalHint, openQs);
        const cap = Math.min(kHybrid, 48);
        const jsonl = rr.slice(0, cap).map((ln, i) => formatHit(`hybrid:${i}`, 1 - i * 0.01, ln));
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
        const memType = String(args["memory_type"] ?? "").trim().toLowerCase();
        if (!memType || !(MEMORY_TYPES as readonly string[]).includes(memType)) {
          return { ok: false, error: `memory_type must be one of: ${MEMORY_TYPES.join(", ")}` };
        }
        if (excludeTypes.has(memType.toLowerCase())) {
          return { ok: true, output: `mode=type\n(no matches in excluded type: ${memType})` };
        }
        const prefix = `${memType}:`;
        const raw = await loadRawNotes();
        const qForOverlap = [goalHint, ...openQs].join(" ").trim();
        const rows = Object.entries(raw)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => {
            const plain = getNoteValue(v);
            const meta = typeof v === "object" ? v : undefined;
            return { k, plain, meta };
          })
          .filter((x) => {
            if (x.meta && minConfidence != null && (x.meta.confidence ?? 0.5) < minConfidence) return false;
            if (x.meta && maxAgeDays != null) {
              const updatedMs = new Date(x.meta.updatedAt).getTime();
              if (Number.isFinite(updatedMs)) {
                const age = (Date.now() - updatedMs) / 86_400_000;
                if (age > maxAgeDays) return false;
              }
            }
            if (qForOverlap && minQueryOverlap != null) {
              const ov = queryOverlap(qForOverlap, `${x.k} ${x.plain}`);
              if (ov < minQueryOverlap) return false;
            }
            return true;
          })
          .map((x) => {
            const w = tierWeight({
              updatedAt: x.meta?.updatedAt,
              lastAccessedAt: x.meta?.lastAccessedAt,
              confidence: x.meta?.confidence ?? 0.5,
              accessCount: x.meta?.accessCount ?? 0,
            });
            return { text: `${x.k}: ${x.plain}`, weight: w };
          })
          .sort((a, b) => b.weight - a.weight);
        const lines = rows.map((x) => x.text);
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
        const limit = Math.min(
          200,
          Math.max(
            1,
            typeof args["limit"] === "number" && Number.isFinite(args["limit"])
              ? Math.round(args["limit"])
              : maxResults ?? 40
          )
        );
        if (!query) return { ok: false, error: "lexical mode requires query" };

        const raw = await loadRawNotes();
        const docs: RankableDoc[] = [];
        for (const [k, v] of Object.entries(raw)) {
          if (typeFilter && !k.startsWith(`${typeFilter}:`)) continue;
          const keyType = getKeyType(k)?.toLowerCase();
          if (keyType && excludeTypes.has(keyType)) continue;
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
          if (minConfidence != null && (confidence ?? 0.5) < minConfidence) continue;
          if (maxAgeDays != null && updatedAt) {
            const updatedMs = new Date(updatedAt).getTime();
            if (Number.isFinite(updatedMs)) {
              const age = (Date.now() - updatedMs) / 86_400_000;
              if (age > maxAgeDays) continue;
            }
          }
          if (minQueryOverlap != null) {
            const ov = queryOverlap(query, `${k} ${plain}`);
            if (ov < minQueryOverlap) continue;
          }
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
        const weighted = ranked
          .map((r) => {
            const rv = raw[r.id];
            const meta = typeof rv === "object" ? (rv as StoredNote) : undefined;
            const w = tierWeight({
              updatedAt: meta?.updatedAt,
              lastAccessedAt: meta?.lastAccessedAt,
              confidence: meta?.confidence ?? 0.5,
              accessCount: meta?.accessCount ?? 0,
            });
            return { ...r, score: r.score * w };
          })
          .sort((a, b) => b.score - a.score);
        void bumpNoteMetadata(weighted.map((r) => r.id));
        const lines = weighted.map((r) => {
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
