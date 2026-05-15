import { defineTool } from "./helpers.js";
import { ensureRunState, loadIR, saveIR, scoreQuality, setRunStage } from "./doc_engine.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";

export const docQualityReportTool = defineTool({
  name: "doc_quality_report",
  description: "Compute weighted AAA-quality score and issue summary for a document IR.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const doc = await loadIR(docId);
    const runState = ensureRunState(doc);
    const report = scoreQuality(doc);
    const min = Math.max(0, Math.min(100, parseInt(effectiveHarnessEnvRaw("AGENT_DOC_QUALITY_MIN") ?? "90", 10) || 90));
    const severe: string[] = [];
    if ((doc.claimSources?.length ?? 0) > 0 && (doc.claimSources ?? []).some((c) => c.sources.length === 0)) {
      severe.push("missing_claim_citations");
    }
    if (report.score < min) severe.push("below_quality_threshold");
    runState.warnings.push(...severe);
    if (severe.length > 0) runState.failures += 1;
    setRunStage(doc, "qa_scored", severe.length > 0 ? "best_effort_with_warnings" : "qa_passed");
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return {
      ok: true,
      output: JSON.stringify(
        { ...report, quality_min: min, meets_threshold: report.score >= min, severe_failures: severe, fallback_recommended: severe.length > 0 },
        null,
        2
      ),
    };
  },
});

