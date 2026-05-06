import { defineTool } from "./helpers.js";
import { loadIR, saveIR, setRunStage } from "./doc_engine.js";

export const docSelectAssetsTool = defineTool({
  name: "doc_select_assets",
  description: "Select slide assets and link each to a tracked source with rationale.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      assets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chunk_id: { type: "string" },
            kind: { type: "string" },
            source_ref: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["chunk_id", "kind", "source_ref"],
        },
      },
    },
    required: ["doc_id", "assets"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const assets = Array.isArray(args["assets"]) ? (args["assets"] as Record<string, unknown>[]) : [];
    if (!docId || assets.length === 0) return { ok: false, error: "doc_id and assets are required" };
    const doc = await loadIR(docId);
    doc.assetSelections = doc.assetSelections ?? [];
    for (const asset of assets) {
      const chunkId = String(asset["chunk_id"] ?? "").trim();
      const kind = String(asset["kind"] ?? "").trim();
      const sourceRef = String(asset["source_ref"] ?? "").trim();
      if (!chunkId || !kind || !sourceRef) continue;
      doc.assetSelections.push({
        slideOrChunkId: chunkId,
        kind,
        sourceRef,
        rationale: String(asset["rationale"] ?? "").trim() || undefined,
      });
    }
    setRunStage(doc, "researching", `selected ${doc.assetSelections.length} assets`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, selected_assets: doc.assetSelections.length }, null, 2) };
  },
});

