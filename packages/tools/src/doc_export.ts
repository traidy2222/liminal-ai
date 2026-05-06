import { defineTool } from "./helpers.js";
import { bundleDir, ensureRunState, loadIR, manifestPath, saveIR, scoreQuality, setRunStage } from "./doc_engine.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const docExportTool = defineTool({
  name: "doc_export",
  description: "Write deterministic export manifest for generated document artifacts.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      renderer_version: { type: "string" },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const rendererVersion = String(args["renderer_version"] ?? "v1");
    const doc = await loadIR(docId);
    const runState = ensureRunState(doc);
    const quality = scoreQuality(doc);
    const min = Math.max(0, Math.min(100, parseInt(process.env["AGENT_DOC_QUALITY_MIN"] ?? "90", 10) || 90));
    const status = quality.score >= min ? "final" : "best_effort_with_warnings";
    const root = bundleDir(docId);
    await mkdir(root, { recursive: true });
    const notesPath = join(root, "speaker_notes.md");
    const sourcesPath = join(root, "sources.json");
    const qualityPath = join(root, "quality_report.json");
    const runPath = join(root, "run_manifest.json");
    const notes = doc.chunks
      .map((c, i) => `## Slide ${i + 1}: ${c.title}\n${c.narrative ?? c.bullets.join("\n- ")}\n`)
      .join("\n");
    await writeFile(notesPath, notes, "utf8");
    await writeFile(sourcesPath, JSON.stringify({ doc_id: docId, sources: doc.sourceMap ?? [], claims: doc.claimSources ?? [] }, null, 2), "utf8");
    await writeFile(qualityPath, JSON.stringify({ ...quality, quality_min: min, meets_threshold: quality.score >= min }, null, 2), "utf8");
    const manifest = {
      doc_id: doc.id,
      title: doc.title,
      renderer_version: rendererVersion,
      status,
      style_genome_id: doc.style.id,
      style_seed: doc.style.seed,
      lint_history_count: doc.lintHistory.length,
      repair_history_count: doc.repairHistory.length,
      source_count: doc.sourceMap?.length ?? 0,
      asset_count: doc.assetSelections?.length ?? 0,
      quality_status: quality.score >= min ? "meets_threshold" : "below_threshold_shipped",
      warnings: runState.warnings,
      stage_trace: runState.stageTrace,
      exports: doc.exports,
      export_paths: doc.exports.map((e) => e.path),
      bundle: {
        dir: root,
        speaker_notes: notesPath,
        sources: sourcesPath,
        quality_report: qualityPath,
      },
      generated_at: new Date().toISOString(),
    };
    const out = manifestPath(docId);
    await writeFile(out, JSON.stringify(manifest, null, 2), "utf8");
    await writeFile(runPath, JSON.stringify(manifest, null, 2), "utf8");
    setRunStage(doc, "exported", status);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return {
      ok: true,
      output: JSON.stringify(
        {
          doc_id: docId,
          manifest_path: out,
          run_manifest_path: runPath,
          status,
          quality_status: manifest.quality_status,
          warnings: manifest.warnings,
          confidence_summary:
            status === "final"
              ? "High confidence in structure and export integrity."
              : "Best-effort output shipped with diagnostics; review warnings before external distribution.",
          limitations:
            status === "final"
              ? []
              : ["Quality threshold not fully met", "Potential unresolved citation/layout issues"],
        },
        null,
        2
      ),
    };
  },
});

