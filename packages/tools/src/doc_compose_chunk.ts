import { defineTool } from "./helpers.js";
import { loadIR, saveIR, setRunStage } from "./doc_engine.js";

export const docComposeChunkTool = defineTool({
  name: "doc_compose_chunk",
  description: "Compose one planned chunk into structured bullets/narrative in the Document IR.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      chunk_id: { type: "string" },
      bullets: { type: "array", items: { type: "string" } },
      narrative: { type: "string" },
      visuals: { type: "array", items: { type: "object" } },
    },
    required: ["doc_id", "chunk_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const chunkId = String(args["chunk_id"] ?? "");
    if (!docId || !chunkId) return { ok: false, error: "doc_id and chunk_id are required" };
    const doc = await loadIR(docId);
    const idx = doc.chunks.findIndex((c) => c.id === chunkId);
    if (idx < 0) return { ok: false, error: `chunk not found: ${chunkId}` };
    const prior = doc.chunks[idx]!;
    const bulletsRaw = Array.isArray(args["bullets"])
      ? (args["bullets"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const bullets = bulletsRaw.length > 0 ? bulletsRaw : [`Core point about ${prior.title}`, "Evidence", "Action"];
    const visuals = Array.isArray(args["visuals"])
      ? (args["visuals"] as unknown[]).map((x) => {
          const y = x as Record<string, unknown>;
          return {
            kind: (String(y["kind"] ?? "quote") as "chart" | "image" | "table" | "quote"),
            note: typeof y["note"] === "string" ? y["note"] : undefined,
          };
        })
      : prior.visuals;
    doc.chunks[idx] = {
      ...prior,
      bullets,
      narrative: typeof args["narrative"] === "string" ? args["narrative"] : prior.narrative,
      visuals,
      status: "composed",
      lintIssues: [],
    };
    setRunStage(doc, "composing", `composed ${chunkId}`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return {
      ok: true,
      output: JSON.stringify({ doc_id: docId, chunk_id: chunkId, status: "composed", bullets: bullets.length }, null, 2),
    };
  },
});

