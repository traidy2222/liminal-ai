import type { PersonaConfig } from "@liminal/core";

/**
 * Generate a PersonaConfig from a natural-language description using the LLM.
 *
 * Uses a single focused chat completion call with an anti-roleplay generation prompt.
 * Returns a fallback PersonaConfig if the LLM call fails or returns malformed JSON.
 *
 * Anti-roleplay constraints are baked into the generation prompt so the resulting
 * persona voice guidance never encourages asterisk actions, monologues, or breaking
 * task focus.
 */
export async function generatePersona(
  description: string,
  apiKey: string,
  model: string,
  baseURL: string
): Promise<PersonaConfig> {
  const systemPrompt =
    "You generate AI assistant persona configurations as JSON. " +
    "Output ONLY valid JSON with no markdown, no code fences, no explanation.";

  const userPrompt =
    `Create an AI assistant persona for: "${description}"\n\n` +
    `Return a JSON object with EXACTLY these fields:\n` +
    `- "name": short display name (1-3 words, e.g. "JARVIS", "Scout", "Dr. Unit")\n` +
    `- "description": one concise sentence describing the assistant's character\n` +
    `- "voice": 2-4 short sentences describing HOW to phrase answers (tone, sentence style, vocabulary choices)\n` +
    `- "traits": array of 3-5 one-word personality descriptors\n\n` +
    `CRITICAL CONSTRAINTS — the voice guidance MUST follow these rules:\n` +
    `1. Change vocabulary and phrasing style ONLY — never change task priorities or capabilities\n` +
    `2. Never include "stay in character", "roleplay as", "pretend to be", or "act like"\n` +
    `3. Never suggest asterisk actions (*does thing*), emotes, or theatrical performances\n` +
    `4. Never sacrifice task accuracy or completeness for character consistency\n` +
    `5. The assistant must remain direct and complete actual tasks regardless of persona`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/liminal-ai",
        "X-Title": "Liminal",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 400,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from the response — strip any accidental markdown fences
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object in response");

    const parsed = JSON.parse(jsonMatch[0]) as Partial<PersonaConfig>;

    // Validate required fields
    if (typeof parsed.name !== "string" || typeof parsed.description !== "string") {
      throw new Error("Missing required name or description fields");
    }

    return {
      name: parsed.name.slice(0, 40),
      description: parsed.description.slice(0, 120),
      voice: typeof parsed.voice === "string" ? parsed.voice.slice(0, 400) : undefined,
      traits: Array.isArray(parsed.traits)
        ? (parsed.traits as unknown[])
            .filter((t): t is string => typeof t === "string")
            .slice(0, 8)
        : undefined,
    };
  } catch (err) {
    // Fallback: construct a minimal persona from the raw description
    const name = description
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return {
      name,
      description: description.slice(0, 120),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
