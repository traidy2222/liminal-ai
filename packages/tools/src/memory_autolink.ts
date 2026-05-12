/**
 * Optional A-Mem–style wikilink suggestions (OpenRouter JSON).
 */
import { withProviderRequestSpacing } from "@liminal/core";
export async function suggestWikilinkLine(params: {
  title: string;
  body: string;
  candidateTitles: string[];
}): Promise<string | null> {
  if (process.env["AGENT_MEMORY_AUTOLINK"] !== "1") return null;
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return null;
  const model = process.env["AGENT_MEMORY_AUTOLINK_MODEL"]?.trim() || "openrouter/owl-alpha";
  const base = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
  const cand = params.candidateTitles.slice(0, 40).join(" | ");
  try {
    const res = await withProviderRequestSpacing(
      { apiKey, baseURL: base },
      () =>
        fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/liminal-ai",
            "X-Title": "Liminal-memory-autolink",
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 120,
            messages: [
              {
                role: "system",
                content:
                  "You suggest 0-3 Obsidian wikilinks for a new note. Reply JSON only: {\"links\":[\"Title1\",...]} " +
                  "Use ONLY titles from the candidate list (exact spelling). Empty array if none fit.",
              },
              {
                role: "user",
                content:
                  `New note title: ${params.title}\nBody excerpt:\n${params.body.slice(0, 1200)}\n\nCandidates:\n${cand}`,
              },
            ],
          }),
        })
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "{}";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { links?: string[] };
    const links = (parsed.links ?? []).filter(
      (t) => typeof t === "string" && params.candidateTitles.includes(t)
    );
    if (links.length === 0) return null;
    return "\n\n## Related\n" + links.map((t) => `- [[${t}]]`).join("\n");
  } catch {
    return null;
  }
}
