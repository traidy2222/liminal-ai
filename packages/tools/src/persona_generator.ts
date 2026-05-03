import type { PersonaProfile } from "./persona_presets.js";

/**
 * Generate a full rich PersonaProfile from a natural-language description.
 *
 * Calls the LLM with a detailed schema prompt and anti-roleplay constraints.
 * All generated content is bounded to keep the AI task-competent — the persona
 * governs tone and vocabulary, never accuracy or capability.
 *
 * @param input      - Natural-language description (e.g. "sarcastic British programmer")
 * @param strength   - Persona strength 1-10 (default 8)
 * @param modifier   - Optional adjustment ("but less aggressive", "but more technical")
 * @param apiKey     - OpenRouter API key
 * @param model      - Model identifier
 * @param baseURL    - API base URL
 */
export async function generatePersonaProfile(
  input: string,
  strength: number,
  modifier: string | undefined,
  apiKey: string,
  model: string,
  baseURL: string
): Promise<PersonaProfile> {
  const systemPrompt =
    "You generate rich AI assistant persona configurations as structured JSON. " +
    "Output ONLY valid JSON — no markdown, no code fences, no explanation. " +
    "The persona is for an AI assistant that helps with real tasks.";

  const userPrompt =
    `Create a rich persona profile for an AI assistant described as: "${input}"
Persona strength: ${strength}/10${modifier ? `\nModifier to apply: "${modifier}"` : ""}

Return this exact JSON structure:
{
  "name": "display name (1-3 words)",
  "coreIdentity": "one sentence: who they are and their core trait",
  "background": "1-2 sentences of context",
  "selfImage": "how they see themselves, one sentence",
  "speechStyle": {
    "sentenceStructure": "description of sentence patterns (length, fragments, structure)",
    "formality": "very_formal|formal|casual|very_casual|mixed",
    "favoriteWords": ["word1", "word2", "...up to 10 words or short phrases"],
    "avoidWords": ["word1", "...up to 6 words they would never say"],
    "commonMetaphors": ["metaphor or frame 1", "...up to 4"],
    "rhythm": "cadence and pace description"
  },
  "tone": {
    "confidence": 0-10,
    "humorStyle": "description of humor style or 'none'",
    "aggression": 0-10,
    "emotionalFlavor": "dominant emotional register (2-5 words)",
    "posture": "how they position themselves in conversation (one sentence)"
  },
  "catchphrases": ["phrase they would actually say 1", "...up to 7"],
  "verbalTics": ["structural speech pattern 1", "...up to 5"],
  "thinkingStyle": "how they reason through problems (1-2 sentences)",
  "decisionFramework": "how they frame decisions (1-2 sentences)",
  "neverDo": ["behavior to avoid 1", "...up to 5"],
  "alwaysDo": ["behavioral guarantee 1", "...up to 5"],
  "strength": ${strength},
  "modifier": ${modifier ? `"${modifier}"` : "null"}
}

HARD CONSTRAINTS — every field must comply:
1. "neverDo" MUST include "Use asterisk actions (*does thing*)" and "Write theatrical monologues"
2. Catchphrases must be things a person would say when helping someone with a task
3. Speech style changes HOW things are delivered, never whether they are accurate
4. The persona makes the AI MORE engaging — not less capable or less helpful
5. "alwaysDo" MUST include "Complete the task accurately regardless of persona strength"
6. favoriteWords and catchphrases must be appropriate for a work/help context
7. Do NOT generate persona content that encourages ignoring the user's actual request`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

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
        max_tokens: 900,
        temperature: 0.75,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    // Strip potential markdown fences
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object in LLM response");

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return sanitizeProfile(raw, input, strength, modifier);
  } catch (err) {
    // Fallback: construct a minimal profile from the raw input
    return buildFallbackProfile(input, strength, modifier);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Sanitize and validate the parsed profile ─────────────────────────────────

function sanitizeProfile(
  raw: Record<string, unknown>,
  input: string,
  strength: number,
  modifier: string | undefined
): PersonaProfile {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v.slice(0, 200) : fallback;

  const arr = (v: unknown, maxLen = 100): string[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.slice(0, maxLen))
      : [];

  const num = (v: unknown, lo = 0, hi = 10, fallback = 5): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? fallback : Math.min(hi, Math.max(lo, Math.round(n)));
  };

  const speechRaw = (raw["speechStyle"] ?? {}) as Record<string, unknown>;
  const toneRaw = (raw["tone"] ?? {}) as Record<string, unknown>;

  // Enforce hard constraints
  const neverDo = arr(raw["neverDo"], 120);
  if (!neverDo.some((s) => s.toLowerCase().includes("asterisk"))) {
    neverDo.push("Use asterisk actions (*does thing*)");
  }
  if (!neverDo.some((s) => s.toLowerCase().includes("monologue"))) {
    neverDo.push("Write theatrical monologues or dramatic speeches");
  }

  const alwaysDo = arr(raw["alwaysDo"], 120);
  if (!alwaysDo.some((s) => s.toLowerCase().includes("task"))) {
    alwaysDo.push("Complete the task accurately regardless of persona strength");
  }

  return {
    name: str(raw["name"], input.split(" ").slice(0, 2).map(capitalize).join(" ")),
    coreIdentity: str(raw["coreIdentity"], `You are ${str(raw["name"])}.`),
    background: str(raw["background"]),
    selfImage: str(raw["selfImage"]),
    speechStyle: {
      sentenceStructure: str(speechRaw["sentenceStructure"]),
      formality: validateFormality(speechRaw["formality"]),
      favoriteWords: arr(speechRaw["favoriteWords"], 60),
      avoidWords: arr(speechRaw["avoidWords"], 60),
      commonMetaphors: arr(speechRaw["commonMetaphors"], 120),
      rhythm: str(speechRaw["rhythm"]),
    },
    tone: {
      confidence: num(toneRaw["confidence"]),
      humorStyle: str(toneRaw["humorStyle"], "none"),
      aggression: num(toneRaw["aggression"]),
      emotionalFlavor: str(toneRaw["emotionalFlavor"]),
      posture: str(toneRaw["posture"]),
    },
    catchphrases: arr(raw["catchphrases"], 120).slice(0, 8),
    verbalTics: arr(raw["verbalTics"], 200).slice(0, 6),
    thinkingStyle: str(raw["thinkingStyle"]),
    decisionFramework: str(raw["decisionFramework"]),
    neverDo: neverDo.slice(0, 6),
    alwaysDo: alwaysDo.slice(0, 6),
    strength,
    modifier: modifier ?? undefined,
  };
}

function validateFormality(v: unknown): PersonaProfile["speechStyle"]["formality"] {
  const valid = ["very_formal", "formal", "casual", "very_casual", "mixed"];
  return valid.includes(v as string) ? (v as PersonaProfile["speechStyle"]["formality"]) : "casual";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Fallback profile when LLM call fails ────────────────────────────────────

function buildFallbackProfile(
  input: string,
  strength: number,
  modifier: string | undefined
): PersonaProfile {
  const nameParts = input.trim().split(/\s+/).slice(0, 2).map(capitalize);
  const name = nameParts.join(" ");
  return {
    name,
    coreIdentity: `You are ${name} — ${input}.`,
    background: `An AI assistant with the character of: ${input}.`,
    selfImage: `You embody the persona: ${input}.`,
    speechStyle: {
      sentenceStructure: "Varied.",
      formality: "casual",
      favoriteWords: [],
      avoidWords: ["certainly!", "of course!", "as an AI", "I'd be happy to"],
      commonMetaphors: [],
      rhythm: "Natural.",
    },
    tone: {
      confidence: 7,
      humorStyle: "appropriate to character",
      aggression: 3,
      emotionalFlavor: "in character",
      posture: "helpful",
    },
    catchphrases: [],
    verbalTics: [],
    thinkingStyle: `Think and respond as ${name} would.`,
    decisionFramework: "What would this character do or say?",
    neverDo: [
      "Use asterisk actions (*does thing*)",
      "Write theatrical monologues",
      "Break character with generic AI assistant language",
    ],
    alwaysDo: [
      "Complete the task accurately regardless of persona strength",
      "Stay in character while being genuinely helpful",
    ],
    strength,
    modifier,
  };
}
