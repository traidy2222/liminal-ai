import { defineTool } from "./helpers.js";
import { loadIR, saveIR, setRunStage } from "./doc_engine.js";

function parseNums(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

export const docGenerateChartDataTool = defineTool({
  name: "doc_generate_chart_data",
  description: "Attach normalized chart datasets to IR for slide composition and provenance-ready rendering.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      chart_id: { type: "string" },
      title: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            values: { type: "array", items: { type: "number" } },
          },
          required: ["label", "values"],
        },
      },
    },
    required: ["doc_id", "chart_id", "title", "labels", "series"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    if (!docId) return { ok: false, error: "doc_id is required" };
    const chartId = String(args["chart_id"] ?? "").trim();
    const title = String(args["title"] ?? "").trim();
    const labels = Array.isArray(args["labels"]) ? (args["labels"] as unknown[]).map((x) => String(x)) : [];
    const seriesRaw = Array.isArray(args["series"]) ? (args["series"] as Record<string, unknown>[]) : [];
    const series = seriesRaw.map((s) => ({ label: String(s["label"] ?? "series"), values: parseNums(s["values"]) }));
    if (!chartId || !title || labels.length === 0 || series.length === 0) {
      return { ok: false, error: "chart_id, title, labels and series are required" };
    }
    const doc = await loadIR(docId);
    doc.chartData = (doc.chartData ?? []).filter((c) => c.id !== chartId);
    doc.chartData.push({ id: chartId, title, labels, series });
    setRunStage(doc, "researching", `chart dataset attached: ${chartId}`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, chart_id: chartId, series_count: series.length }, null, 2) };
  },
});

