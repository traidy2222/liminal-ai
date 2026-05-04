import { defineTool } from "./helpers.js";

export interface DdgHit {
  url: string;
  title: string;
  snippet: string;
}

export async function runHtmlDdgSearch(
  query: string,
  max: number
): Promise<{ ok: true; hits: DdgHit[] } | { ok: false; error: string }> {
  const q = encodeURIComponent(query);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${q}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 dreamthedream-agent/1.0" },
      signal: AbortSignal.timeout(15_000),
    });

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
    "WHEN: You need to find URLs, recent information, documentation, or answers to factual questions.\n" +
    "NOT WHEN: You already have the URL — call web_fetch directly instead.\n" +
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
  handler: async (args) => {
    const max = (args["max_results"] as number | undefined) ?? 5;
    const r = await runHtmlDdgSearch(args["query"] as string, max);
    if (!r.ok) return r;
    const output = r.hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
      .join("\n\n");
    return { ok: true, output };
  },
});
