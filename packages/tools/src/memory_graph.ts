/**
 * Traverse note graph (links / supersedes / deltaOf) from a seed key.
 */
import { defineTool } from "./helpers.js";
import { loadRawNotes, type StoredNote } from "./notes_store.js";

export const memoryGraphTool = defineTool({
  name: "memory_graph",
  description:
    "WHAT: BFS from a note key following `links[]` edges (outbound) up to depth.\n" +
    "WHEN: Exploring related memories after recall_relevant / search_memory.\n" +
    "ARGS: seed — note key to start from; depth — max hops (default 2, max 4); limit — max nodes (default 24).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      seed: { type: "string", description: "Starting note key" },
      depth: { type: "number", description: "Max BFS depth (default 2)" },
      limit: { type: "number", description: "Max nodes to return (default 24)" },
    },
    required: ["seed"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const seed = (args["seed"] as string).trim();
    const maxDepth = Math.min(4, Math.max(1, (args["depth"] as number | undefined) ?? 2));
    const limit = Math.min(48, Math.max(4, (args["limit"] as number | undefined) ?? 24));
    if (!seed) return { ok: false, error: "seed required" };

    const raw = await loadRawNotes();
    const lines: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ k: string; d: number }> = [{ k: seed, d: 0 }];

    while (queue.length > 0 && lines.length < limit) {
      const { k, d } = queue.shift()!;
      if (visited.has(k) || raw[k] === undefined) continue;
      visited.add(k);

      const n = raw[k];
      const val =
        typeof n === "string" ? n : n && typeof n === "object" ? (n as StoredNote).value : "";
      const sn = typeof n === "object" && n !== null ? (n as StoredNote) : null;
      const edgeList = sn?.links?.filter(Boolean) ?? [];
      const meta = [
        sn?.supersedes ? `supersedes=${sn.supersedes}` : "",
        sn?.deltaOf ? `deltaOf=${sn.deltaOf}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `- [[${k}]]${meta ? ` (${meta})` : ""} — ${String(val).replace(/\s+/g, " ").slice(0, 120)}`
      );

      if (d < maxDepth) {
        for (const t of edgeList) {
          if (!visited.has(t) && raw[t] !== undefined) {
            queue.push({ k: t, d: d + 1 });
          }
        }
      }
    }

    if (lines.length === 0) {
      return { ok: true, output: `(no graph from seed "${seed}" — key missing)` };
    }
    return { ok: true, output: `## Memory graph (depth≤${maxDepth})\n${lines.join("\n")}` };
  },
});
