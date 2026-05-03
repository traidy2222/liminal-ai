import { defineTool } from "./helpers.js";

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
    const query = encodeURIComponent(args["query"] as string);
    const max = (args["max_results"] as number | undefined) ?? 5;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${query}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 dreamthedream-agent/1.0" },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }

      const html = await res.text();

      // Extract result titles and URLs
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

      const output = links
        .map((l, i) => `${i + 1}. ${l.title}\n   ${l.url}\n   ${snippets[i] ?? ""}`)
        .join("\n\n");

      return { ok: true, output };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
