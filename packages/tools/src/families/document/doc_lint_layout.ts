import { defineTool } from "../../shared/helpers.js";
import { lintChunk, loadIR, saveIR, ensureRunState, setRunStage, getBulletText } from "./doc_engine.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";

export const docLintLayoutTool = defineTool({
  name: "doc_lint_layout",
  description: "Run layout/content lint checks for one chunk or whole document.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      chunk_id: { type: "string" },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const chunkId = typeof args["chunk_id"] === "string" ? args["chunk_id"] : undefined;
    if (!docId) return { ok: false, error: "doc_id is required" };
    const doc = await loadIR(docId);
    const runState = ensureRunState(doc);
    const requireCitations = (effectiveHarnessEnvRaw("AGENT_DOC_AUTONOMY") ?? "0") === "1";
    const targets = chunkId ? doc.chunks.filter((c) => c.id === chunkId) : doc.chunks;
    if (targets.length === 0) return { ok: false, error: "no matching chunks" };
    const results: Array<{ chunk_id: string; passed: boolean; issues: string[] }> = [];
    for (const c of targets) {
      const issues = lintChunk(c);
      if (requireCitations && /%|\bdata\b|\bstat\b|\brevenue\b|\bgrowth\b/i.test(`${c.title} ${c.bullets.map(getBulletText).join(" ")}`)) {
        const claimLinked = (doc.claimSources ?? []).some((x) => x.sources.length > 0);
        if (!claimLinked) issues.push("citation_missing_for_factual_content");
      }
      c.lintIssues = issues;
      c.status = issues.length > 0 ? "lint_failed" : c.status === "rendered" ? "rendered" : "composed";
      if (issues.length > 0) {
        runState.warnings.push(`${c.id}:${issues.join(",")}`);
      }
      doc.lintHistory.push({ at: new Date().toISOString(), chunkId: c.id, issues });
      results.push({ chunk_id: c.id, passed: issues.length === 0, issues });
    }
    setRunStage(doc, "linting", `linted ${results.length} chunk(s)`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, results }, null, 2) };
  },
});

