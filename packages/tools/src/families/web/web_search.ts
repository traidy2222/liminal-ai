import { defineTool } from "../../shared/helpers.js";
import {
  formatWebSearchOutput,
  resolveWebSearchProvider,
  runWebSearch,
  webSearchProviderLabel,
} from "./web_search_providers.js";

export type { DdgHit, WebSearchHit } from "./web_search_types.js";
export { normalizeTemporalQuery, runHtmlDdgSearch } from "./web_search_ddg.js";
export { mapSerperOrganic, runSerperSearch } from "./web_search_serper.js";
export {
  formatWebSearchOutput,
  resolveWebSearchProvider,
  runWebSearch,
  webSearchProviderLabel,
} from "./web_search_providers.js";

function buildWebSearchDescription(): string {
  const provider = resolveWebSearchProvider();
  const via = webSearchProviderLabel(provider);
  return (
    `WHAT: Search the web via ${via} and return ranked result titles, URLs, and snippets.\n` +
    "WHEN: You need URLs, recent information, documentation, or answers not available in memory/vault.\n" +
    "OPTIONAL: If the question may already be answered locally, consider memory_query, recall_relevant, or vault_search before spending web quota — not required.\n" +
    "RESEARCH DISCIPLINE: For the first web-search batch, diversify query intents (origins/background, latest status, impact/metrics) and avoid lexical duplicates.\n" +
    "NOT WHEN: You already have the URL — call web_fetch directly instead.\n" +
    "GOOD OUTPUT: A short ranked list of candidate URLs/snippets you will selectively web_fetch or synthesize — not an undifferentiated dump into the user reply.\n" +
    "ARGS: query — search query string; max_results — number of results to return (default: 5)."
  );
}

export const webSearchTool = defineTool({
  name: "web_search",
  description: buildWebSearchDescription(),
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: {
        type: "number",
        description: "Max results to return (default: 5)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const max = (args["max_results"] as number | undefined) ?? 5;
    const inputQuery = String(args["query"] ?? "");
    const provider = resolveWebSearchProvider();
    const result = await runWebSearch(inputQuery, max);
    emit?.(`\nsearching (${provider}): ${result.query.slice(0, 80)}\n`);

    if (result.hits.length === 0 && result.fallbackReason && !result.fallbackFrom) {
      emit?.(`  ✗ ${result.fallbackReason}\n`);
      return { ok: false, error: result.fallbackReason };
    }

    emit?.(`  ✓ ${result.hits.length} results${result.fallbackFrom ? " (fallback)" : ""}\n`);
    return { ok: true, output: formatWebSearchOutput(result) };
  },
});
