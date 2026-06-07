import { effectiveHarnessEnvRaw } from "@liminal/core";
import { normalizeTemporalQuery, runHtmlDdgSearch } from "./web_search_ddg.js";
import { runSerperSearch } from "./web_search_serper.js";
import type { WebSearchProviderId, WebSearchResult } from "./web_search_types.js";

export function resolveWebSearchProvider(): WebSearchProviderId {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_SEARCH_PROVIDER")?.trim().toLowerCase();
  if (raw === "serper") return "serper";
  return "duckduckgo";
}

export function webSearchProviderLabel(provider: WebSearchProviderId): string {
  return provider === "serper" ? "Serper (Google)" : "DuckDuckGo";
}

function fallbackEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_WEB_SEARCH_FALLBACK") !== "0";
}

export interface RunWebSearchDeps {
  fetchFn?: typeof fetch;
  provider?: WebSearchProviderId;
  serperApiKey?: string;
}

export async function runWebSearch(
  inputQuery: string,
  max: number,
  deps: RunWebSearchDeps = {}
): Promise<WebSearchResult & { query: string; inputQuery: string }> {
  const input = inputQuery.trim();
  const query = normalizeTemporalQuery(input);
  const provider = deps.provider ?? resolveWebSearchProvider();
  const fetchFn = deps.fetchFn ?? fetch;

  if (provider === "duckduckgo") {
    const r = await runHtmlDdgSearch(query, max, { fetchImpl: fetchFn });
    if (!r.ok) {
      return {
        query,
        inputQuery: input,
        hits: [],
        provider: "duckduckgo",
        fallbackReason: r.error,
      };
    }
    return { query, inputQuery: input, hits: r.hits, provider: "duckduckgo" };
  }

  const serper = await runSerperSearch(query, max, {
    ...(deps.serperApiKey !== undefined ? { apiKey: deps.serperApiKey } : {}),
    fetchImpl: fetchFn,
  });
  if (serper.ok) {
    return { query, inputQuery: input, hits: serper.hits, provider: "serper" };
  }

  if (!fallbackEnabled()) {
    return {
      query,
      inputQuery: input,
      hits: [],
      provider: "serper",
      fallbackReason: serper.error,
    };
  }

  const ddg = await runHtmlDdgSearch(query, max, { fetchImpl: fetchFn });
  if (!ddg.ok) {
    return {
      query,
      inputQuery: input,
      hits: [],
      provider: "serper",
      fallbackFrom: "serper",
      fallbackReason: `${serper.error}; DuckDuckGo fallback failed: ${ddg.error}`,
    };
  }

  return {
    query,
    inputQuery: input,
    hits: ddg.hits,
    provider: "duckduckgo",
    fallbackFrom: "serper",
    fallbackReason: serper.error,
  };
}

export function formatWebSearchOutput(result: WebSearchResult & { query: string; inputQuery: string }): string {
  const { query, inputQuery, hits } = result;
  if (hits.length === 0) {
    const err = result.fallbackReason;
    if (err && !result.fallbackFrom) {
      return `Web search failed: ${err}`;
    }
    return `No results found for "${query}". Try shorter keywords, alternate spellings, or web_fetch if you already have a URL.`;
  }

  const lines: string[] = [];
  if (result.fallbackFrom === "serper" && result.fallbackReason) {
    lines.push(`Serper failed (${result.fallbackReason}); fell back to DuckDuckGo.`);
  }

  const currentYear = new Date().getFullYear();
  const anchored = query !== inputQuery;
  if (anchored) {
    lines.push(`Recency note: query anchored to current year ${currentYear}.`);
  }

  const body = hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join("\n\n");
  lines.push(body);
  return lines.join("\n\n");
}
