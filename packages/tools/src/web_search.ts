import { defineTool } from "./helpers.js";
import { fetchWithRetry } from "./network_retry.js";
import { buildWebFetchInit } from "./web_fetch_http.js";

export interface DdgHit {
  url: string;
  title: string;
  snippet: string;
}

function normalizeTemporalQuery(query: string): string {
  const q = query.trim();
  if (q.length < 4) return q;
  const lower = q.toLowerCase();
  const isLatestIntent =
    /\blatest|news|update|current|today|this week|this month|recent|breaking|version|release|released|release notes|changelog|what's new\b/.test(
      lower
    );
  if (!isLatestIntent) return q;
  if (/\b(in|during|from)\s+20\d{2}\b/.test(lower)) return q;

  const currentYear = new Date().getFullYear();
  const years = [...q.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1]!, 10));
  if (years.length === 0) {
    return `${q} ${currentYear}`;
  }
  const maxYear = Math.max(...years);
  if (maxYear < currentYear) {
    return q.replace(/\b20\d{2}\b/g, String(currentYear));
  }
  return q;
}

export async function runHtmlDdgSearch(
  query: string,
  max: number
): Promise<{ ok: true; hits: DdgHit[] } | { ok: false; error: string }> {
  const q = encodeURIComponent(query);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${q}`;
    const res = await fetchWithRetry(
      url,
      buildWebFetchInit("primary"),
      { timeoutMs: 15_000 }
    );

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    const snippetRe = /class="result__snippet"[^>]*>([^<]+)/g;

    const links: Array<{ url: string; title: string }> = [];
    const snippets: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = linkRe.exec(html)) !== null && links.length < max) {
      links.push({ url: m[1]!.trim(), title: m[2]!.trim() });
    }
    while ((m = snippetRe.exec(html)) !== null && snippets.length < max) {
      snippets.push(m[1]!.trim());
    }

    if (links.length === 0) {
      return { ok: false, error: "No results found" };
    }

    const hits: DdgHit[] = links.map((l, i) => ({
      url: l.url,
      title: l.title,
      snippet: snippets[i] ?? "",
    }));
    return { ok: true, hits };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "WHAT: Search the web via DuckDuckGo and return ranked result titles, URLs, and snippets.\n" +
    "WHEN: You need URLs, recent information, documentation, or answers not available in memory/vault.\n" +
    "OPTIONAL: If the question may already be answered locally, consider memory_query, recall_relevant, or vault_search before spending web quota — not required.\n" +
    "RESEARCH DISCIPLINE: For the first web-search batch, diversify query intents (origins/background, latest status, impact/metrics) and avoid lexical duplicates.\n" +
    "NOT WHEN: You already have the URL — call web_fetch directly instead.\n" +
    "GOOD OUTPUT: A short ranked list of candidate URLs/snippets you will selectively web_fetch or synthesize — not an undifferentiated dump into the user reply.\n" +
    "ARGS: query — search query string; max_results — number of results to return (default: 5).",
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
    const inputQuery = args["query"] as string;
    const query = normalizeTemporalQuery(inputQuery);
    emit?.(`\nsearching: ${query.slice(0, 80)}\n`);
    const r = await runHtmlDdgSearch(query, max);
    if (r.ok) emit?.(`  ✓ ${r.hits.length} results\n`);
    if (!r.ok) return r;
    const currentYear = new Date().getFullYear();
    const anchored = query !== inputQuery;
    const recencyHint = anchored
      ? `Recency note: query anchored to current year ${currentYear}.\n`
      : "";
    const output = r.hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
      .join("\n\n");
    return { ok: true, output: `${recencyHint}${output}` };
  },
});
