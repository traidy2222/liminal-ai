import { defineTool } from "../../shared/helpers.js";
import { ensureRunState, loadIR, repairChunk, saveIR, setRunStage } from "./doc_engine.js";

export const docRepairChunkTool = defineTool({
  name: "doc_repair_chunk",
  description: "Repair a lint-failed chunk with local transformations only.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      chunk_id: { type: "string" },
    },
    required: ["doc_id", "chunk_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const chunkId = String(args["chunk_id"] ?? "");
    const doc = await loadIR(docId);
    const runState = ensureRunState(doc);
    const idx = doc.chunks.findIndex((c) => c.id === chunkId);
    if (idx < 0) return { ok: false, error: `chunk not found: ${chunkId}` };
    if (runState.repairBudget.used >= runState.repairBudget.max) {
      runState.warnings.push(`repair_budget_exhausted:${chunkId}`);
      runState.failures += 1;
      doc.updatedAt = new Date().toISOString();
      await saveIR(doc);
      return {
        ok: false,
        error: `repair budget exhausted (${runState.repairBudget.used}/${runState.repairBudget.max})`,
      };
    }
    const { chunk, action } = repairChunk(doc.chunks[idx]!);
    if ((chunk.lintIssues ?? []).includes("citation_missing_for_factual_content")) {
      const firstSource = doc.sourceMap?.[0]?.ref;
      if (firstSource) {
        chunk.bullets = [...chunk.bullets, `Source: ${firstSource}`];
      }
    }
    doc.chunks[idx] = chunk;
    runState.repairBudget.used += 1;
    doc.repairHistory.push({ at: new Date().toISOString(), chunkId, action });
    setRunStage(doc, "repairing", `repaired ${chunkId} (${action})`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, chunk_id: chunkId, action }, null, 2) };
  },
});

