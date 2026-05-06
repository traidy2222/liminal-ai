import type { Scenario } from "../runner.js";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

export const documentAutonomyZeroContextScenario: Scenario = {
  name: "document-autonomy-zero-context-complete-deck",
  userMessage:
    "Create a complete PPTX deck about launching an AI support product next quarter. " +
    "Work autonomously end-to-end and provide artifacts with citations and quality reporting.",
  maxRounds: 18,
  timeoutMs: 150_000,
  assertions: [
    { name: "turn_end", check: (trace) => traceHasTurnEnd(trace) },
    { name: "doc_plan used", check: (trace) => traceHasTool(trace, "doc_plan") },
    { name: "doc_research_brief used", check: (trace) => traceHasTool(trace, "doc_research_brief") },
    { name: "doc_collect_sources used", check: (trace) => traceHasTool(trace, "doc_collect_sources") },
    { name: "doc_render_pptx used", check: (trace) => traceHasTool(trace, "doc_render_pptx") },
    { name: "doc_export used", check: (trace) => traceHasTool(trace, "doc_export") },
  ],
};

export const documentAutonomyCitationScenario: Scenario = {
  name: "document-autonomy-fact-heavy-citations",
  userMessage:
    "Generate a factual board deck on cloud cost optimization trends, with citations and uncertainty handling.",
  maxRounds: 18,
  timeoutMs: 150_000,
  assertions: [
    { name: "doc_collect_sources used", check: (trace) => traceHasTool(trace, "doc_collect_sources") },
    { name: "doc_quality_report used", check: (trace) => traceHasTool(trace, "doc_quality_report") },
    { name: "doc_lint_layout used", check: (trace) => traceHasTool(trace, "doc_lint_layout") },
  ],
};

export const documentAutonomyDegradedNetworkScenario: Scenario = {
  name: "document-autonomy-best-effort-on-degraded-research",
  userMessage:
    "Create a PPTX deck about a fast-moving topic with likely source gaps and still ship best-effort artifact bundle with explicit warnings and limitations.",
  maxRounds: 18,
  timeoutMs: 150_000,
  assertions: [
    { name: "doc_plan used", check: (trace) => traceHasTool(trace, "doc_plan") },
    { name: "doc_render_pptx used", check: (trace) => traceHasTool(trace, "doc_render_pptx") },
    { name: "doc_export used", check: (trace) => traceHasTool(trace, "doc_export") },
    { name: "doc_quality_report used", check: (trace) => traceHasTool(trace, "doc_quality_report") },
  ],
};

export const DOCUMENT_AUTONOMY_SCENARIOS = [
  documentAutonomyZeroContextScenario,
  documentAutonomyCitationScenario,
  documentAutonomyDegradedNetworkScenario,
];

