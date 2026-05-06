import { defineTool } from "./helpers.js";
import {
  buildInitialChunks,
  saveIR,
  synthesizeStyleGenome,
  defaultOutlineFromObjective,
  saveStyleSignature,
  ensureRunState,
  setRunStage,
} from "./doc_engine.js";
import { isStyleDiverseEnough } from "./doc_style_memory.js";
import type { DocumentIR } from "@liminal/core";

function makeDocId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `doc-${slug || "untitled"}-${Date.now().toString(36)}`;
}

export const docPlanTool = defineTool({
  name: "doc_plan",
  description:
    "Create Document IR plan with semantic outline, style genome, and chunk scaffold for progressive composition. Supports format targets: pptx (ppx alias), docx, pdf.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      objective: { type: "string" },
      topic: { type: "string" },
      audience: { type: "string" },
      tone: { type: "string" },
      autonomy_mode: { type: "string" },
      narrative_beats: { type: "array", items: { type: "string" } },
      format_targets: {
        type: "array",
        items: { type: "string" },
      },
      semantic_outline: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const normalizeFormat = (raw: string): "pptx" | "docx" | "pdf" | null => {
      const v = raw.trim().toLowerCase();
      if (v === "ppx") return "pptx";
      if (v === "pptx" || v === "docx" || v === "pdf") return v;
      return null;
    };
    const title = String(args["title"] ?? "").trim();
    const topic = String(args["topic"] ?? "").trim();
    const objective = String((args["objective"] ?? topic) || title).trim();
    const audience = String(args["audience"] ?? "general").trim();
    const tone = String(args["tone"] ?? "professional").trim();
    const autonomyMode = String(args["autonomy_mode"] ?? "max") as "max" | "guided" | "strict";
    const narrativeBeats = Array.isArray(args["narrative_beats"])
      ? (args["narrative_beats"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const formatTargetsRaw = Array.isArray(args["format_targets"]) ? (args["format_targets"] as unknown[]) : ["pptx"];
    const formatTargets = formatTargetsRaw
      .map((x) => normalizeFormat(String(x)))
      .filter((x): x is "pptx" | "docx" | "pdf" => x !== null);
    const outlineProvided = (Array.isArray(args["semantic_outline"]) ? args["semantic_outline"] : [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    const outline = outlineProvided.length > 0 ? outlineProvided : defaultOutlineFromObjective(objective);
    if (!title || !objective || outline.length === 0) {
      return { ok: false, error: "title is required and objective/outline must resolve to non-empty content" };
    }
    const id = makeDocId(title);
    const styleSeed = `${title}|${audience}|${tone}|${objective}`;
    let style = synthesizeStyleGenome(styleSeed);
    if (!(await isStyleDiverseEnough(style))) {
      style = synthesizeStyleGenome(`${styleSeed}|${Date.now()}`);
    }
    const now = new Date().toISOString();
    const doc: DocumentIR = {
      id,
      createdAt: now,
      updatedAt: now,
      title,
      objective,
      audience,
      tone,
      autonomyMode,
      formatTargets: formatTargets.length > 0 ? formatTargets : ["pptx"],
      semanticOutline: outline,
      narrativeBeats,
      chunks: buildInitialChunks(outline),
      style,
      claimSources: [],
      sourceMap: [],
      assetSelections: [],
      chartData: [],
      lintHistory: [],
      repairHistory: [],
      exports: [],
    };
    ensureRunState(doc);
    setRunStage(doc, "planned", "doc_plan created initial IR");
    await saveIR(doc);
    await saveStyleSignature(id, style);
    return {
      ok: true,
      output: JSON.stringify(
        {
          doc_id: id,
          chunks: doc.chunks.map((c) => ({ id: c.id, title: c.title, status: c.status })),
          style_genome_id: style.id,
        },
        null,
        2
      ),
    };
  },
});

