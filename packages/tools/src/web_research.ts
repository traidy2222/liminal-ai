/**
 * Orchestrates web_search → web_fetch → lightweight multi-source synthesis.
 */
import { defineTool } from "./helpers.js";
import { runHtmlDdgSearch } from "./web_search.js";
import { runWebFetch } from "./web_fetch.js";

async function synthesizeResearch(question: string, sources: { url: string; excerpt: string }[]): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  if (!apiKey || sources.length === 0) {
    return JSON.stringify({
      agreements: ["(synthesis skipped — no API key or no sources)"],
      disagreements: [],
      confidence: "low",
    });
  }
  const base = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model =
    process.env["AGENT_FAST_MODEL"]?.trim() ||
    process.env["EVAL_MODEL"]?.trim() ||
    "openai/gpt-4o-mini";
  const body = sources
    .map((s, i) => `--- Source ${i + 1}: ${s.url}\n${s.excerpt.slice(0, 2500)}`)
    .join("\n\n");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/liminal-ai",
        "X-Title": "Liminal-web-research",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You compare web sources for a factual question. Return JSON only: " +
              '{"agreements": string[], "disagreements": string[], "confidence": "high"|"med"|"low"}',
          },
          {
            role: "user",
            content: `Question: ${question.slice(0, 500)}\n\nSources:\n${body.slice(0, 12_000)}`,
          },
        ],
      }),
    });
    if (!res.ok) return JSON.stringify({ agreements: [], disagreements: [`HTTP ${res.status}`], confidence: "low" });
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? "{}";
  } catch (e) {
    return JSON.stringify({ agreements: [], disagreements: [String(e)], confidence: "low" });
  }
}

export const webResearchTool = defineTool({
  name: "web_research",
  description:
    "WHAT: Run DuckDuckGo search, fetch top pages, return excerpts + JSON agreements/disagreements/confidence.\n" +
    "WHEN: Multi-source factual comparison; heavier than web_search alone.\n" +
    "ARGS: question — topic; k_sources — pages to fetch (default 3, max 5).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      k_sources: { type: "number", description: "How many top hits to fetch (default 3)" },
    },
    required: ["question"],
    additionalProperties: false,
  },
  handler: async (args) => {
    if (process.env["AGENT_WEB_RESEARCH"] !== "1") {
      return {
        ok: false,
        error: "Set AGENT_WEB_RESEARCH=1 to enable web_research orchestration.",
      };
    }
    const question = String(args["question"] ?? "").trim();
    const k = Math.min(5, Math.max(1, (args["k_sources"] as number | undefined) ?? 3));
    if (!question) return { ok: false, error: "question required" };

    const sr = await runHtmlDdgSearch(question, k);
    if (!sr.ok) return sr;

    const sources: { url: string; title: string; excerpt: string }[] = [];
    for (const h of sr.hits.slice(0, k)) {
      const u = h.url.startsWith("//") ? `https:${h.url}` : h.url;
      const fr = await runWebFetch(u, 4500);
      if (fr.ok) {
        sources.push({
          url: u,
          title: h.title,
          excerpt: fr.output.slice(0, 4000),
        });
      }
    }

    const synth = await synthesizeResearch(
      question,
      sources.map((s) => ({ url: s.url, excerpt: s.excerpt }))
    );

    const out =
      `## web_research\n` +
      `### Sources (${sources.length})\n` +
      sources.map((s, i) => `${i + 1}. **${s.title}**\n   ${s.url}\n   _${s.excerpt.slice(0, 400)}…_\n`).join("\n") +
      `\n### Synthesis (JSON)\n${synth}`;
    return { ok: true, output: out.slice(0, 25_000) };
  },
});
