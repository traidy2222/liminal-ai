import { defineTool } from "./helpers.js";

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "WHAT: Fetch the full content of a specific URL and return it as plain text (HTML stripped).\n" +
    "WHEN: You already have the exact URL and need its content — documentation pages, APIs, articles.\n" +
    "NOT WHEN: You don't have the URL yet — use web_search first to find it.\n" +
    "ARGS: url — full URL to fetch; max_chars — character limit on returned text (default: 8000).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 60_000,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      max_chars: {
        type: "number",
        description: "Maximum characters to return (default: 8000)",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const url = args["url"] as string;
    const maxChars = (args["max_chars"] as number | undefined) ?? 8000;

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 dreamthedream-agent/1.0" },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
      }

      const text = await res.text();
      // Strip HTML tags and collapse whitespace
      const stripped = text
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return { ok: true, output: stripped.slice(0, maxChars) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
