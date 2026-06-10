import { defineTool } from "../../shared/helpers.js";
import { loadIR, saveIR, setRunStage } from "./doc_engine.js";

export const docResearchBriefTool = defineTool({
  name: "doc_research_brief",
  description:
    "Autonomously infer audience intent, narrative beats, and key claims requiring evidence for a document IR.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      audience_intent: { type: "string" },
      narrative_beats: { type: "array", items: { type: "string" } },
      claims: { type: "array", items: { type: "string" } },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    if (!docId) return { ok: false, error: "doc_id is required" };
    const doc = await loadIR(docId);
    const audienceIntent = String(args["audience_intent"] ?? `${doc.audience} needs decision-ready clarity`).trim();
    const beats = Array.isArray(args["narrative_beats"])
      ? (args["narrative_beats"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : doc.semanticOutline.map((s, i) => `Beat ${i + 1}: ${s}`);
    const claims = Array.isArray(args["claims"])
      ? (args["claims"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : doc.semanticOutline.slice(0, 4).map((s) => `Claim: ${s}`);
    doc.narrativeBeats = beats;
    doc.claimSources = claims.map((claim) => ({
      claim,
      sources: [],
      sourceQuality: "secondary" as const,
      asOf: new Date().toISOString(),
      confidence: "low" as const,
    }));
    doc.chunks = doc.chunks.map((c, i) => ({
      ...c,
      audienceIntent,
      narrativeBeat: beats[i] ?? beats[beats.length - 1] ?? "Beat",
      visualIntent: c.visualIntent ?? "supporting_visual",
    }));
    setRunStage(doc, "researching", "brief inferred claims and beats");
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return {
      ok: true,
      output: JSON.stringify({ doc_id: docId, audience_intent: audienceIntent, beats: beats.length, claims: claims.length }, null, 2),
    };
  },
});

