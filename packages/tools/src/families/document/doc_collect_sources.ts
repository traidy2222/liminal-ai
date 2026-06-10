import { defineTool } from "../../shared/helpers.js";
import { loadIR, saveIR, setRunStage, sourceQualityForRef } from "./doc_engine.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";

type SourceInput = { type?: string; ref?: string; note?: string };

export const docCollectSourcesTool = defineTool({
  name: "doc_collect_sources",
  description: "Attach source references and provenance to claims in document IR.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            ref: { type: "string" },
            note: { type: "string" },
          },
          required: ["ref"],
        },
      },
    },
    required: ["doc_id", "sources"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const sources = (Array.isArray(args["sources"]) ? args["sources"] : []) as SourceInput[];
    if (!docId || sources.length === 0) return { ok: false, error: "doc_id and non-empty sources are required" };
    const doc = await loadIR(docId);
    const sourceCap = Math.max(4, parseInt(effectiveHarnessEnvRaw("AGENT_DOC_MAX_SOURCE_LOOKUPS") ?? "24", 10) || 24);
    doc.sourceMap = doc.sourceMap ?? [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const ref = String(src.ref ?? "").trim();
      if (!ref) continue;
      if (doc.sourceMap.length >= sourceCap) break;
      doc.sourceMap.push({
        id: `src-${Date.now().toString(36)}-${i}`,
        type: (src.type === "local" || src.type === "generated" ? src.type : "web") as "web" | "local" | "generated",
        ref,
        note: src.note?.trim(),
      });
    }
    const sourceMap = doc.sourceMap ?? [];
    doc.claimSources = (doc.claimSources ?? []).map((c, idx) => ({
      ...c,
      sources: c.sources.length > 0 ? c.sources : sourceMap.slice(idx, idx + 2).map((s) => s.ref),
      sourceQuality: sourceQualityForRef((c.sources.length > 0 ? c.sources[0] : sourceMap[idx]?.ref) ?? ""),
      asOf: c.asOf ?? new Date().toISOString(),
      confidence: c.sources.length > 0 || sourceMap.length > idx ? "med" : c.confidence,
    }));
    setRunStage(doc, "researching", `collected ${doc.sourceMap.length} source references`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, source_count: doc.sourceMap.length }, null, 2) };
  },
});

