import type { Scenario } from "../runner.js";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

export const documentPipelineScenario: Scenario = {
  name: "document-pipeline-progressive-quality",
  userMessage:
    "Create a short investor update deck using document tools only. " +
    "Use this order: doc_plan -> doc_compose_chunk (for each chunk) -> doc_lint_layout -> doc_repair_chunk if needed -> doc_render_pptx -> doc_export -> doc_quality_report.",
  maxRounds: 16,
  timeoutMs: 120_000,
  assertions: [
    { name: "turn_end", check: (trace) => traceHasTurnEnd(trace) },
    { name: "doc_plan used", check: (trace) => traceHasTool(trace, "doc_plan") },
    { name: "doc_compose_chunk used", check: (trace) => traceHasTool(trace, "doc_compose_chunk") },
    { name: "doc_lint_layout used", check: (trace) => traceHasTool(trace, "doc_lint_layout") },
    { name: "doc_render_pptx used", check: (trace) => traceHasTool(trace, "doc_render_pptx") },
    { name: "doc_export used", check: (trace) => traceHasTool(trace, "doc_export") },
    { name: "doc_quality_report used", check: (trace) => traceHasTool(trace, "doc_quality_report") },
  ],
};

export const documentStyleDiversityScenario: Scenario = {
  name: "document-pipeline-style-diversity-and-export-contract",
  userMessage:
    "Create a visual-heavy pitch deck as PPTX only, with clear style variation and a full export bundle including manifest and quality report.",
  maxRounds: 18,
  timeoutMs: 140_000,
  assertions: [
    { name: "doc_plan used", check: (trace) => traceHasTool(trace, "doc_plan") },
    { name: "doc_render_pptx used", check: (trace) => traceHasTool(trace, "doc_render_pptx") },
    { name: "doc_export used", check: (trace) => traceHasTool(trace, "doc_export") },
    { name: "doc_quality_report used", check: (trace) => traceHasTool(trace, "doc_quality_report") },
  ],
};

export const DOCUMENT_SCENARIOS = [documentPipelineScenario, documentStyleDiversityScenario];

