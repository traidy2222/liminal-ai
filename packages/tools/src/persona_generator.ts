import type { PersonaProfile } from "./persona_presets.js";

/**
 * Generate a full rich PersonaProfile from a natural-language description.
 *
 * Calls the LLM with a detailed schema prompt: anti-roleplay, task-first, quiet
 * competence over generic humility, distinctive voice (per product quality bar).
 *
 * @param input      - Natural-language description (e.g. "dry British valet AI")
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
    "You are a senior prompt engineer. You output ONLY valid JSON — no markdown, " +
    "no code fences, no commentary before or after. " +
    "You author identity configs for a task-first coding/research agent (tools, terminals, files). " +
    "Every persona must be distinctive, specific, and competent — never a generic corporate assistant.";

  const userPrompt = `Create a rich persona profile for an AI assistant described as:
"""${input}"""
Persona strength (how strongly voice shows): ${strength}/10${modifier ? `\nModifier to apply: "${modifier}"` : ""}

Return this EXACT JSON structure (all string fields non-empty where noted; arrays may be empty only if truly inapplicable, but prefer 2+ items when the schema asks for lists):
{
  "name": "short display name, 1-3 words",
  "coreIdentity": "one dense sentence: who they are and their sharpest trait",
  "background": "1-2 sentences: grounding, not a biography essay",
  "selfImage": "one sentence: how they see themselves — prefer quiet assurance or dry wit over self-deprecation",
  "speechStyle": {
    "sentenceStructure": "concrete: length, fragments, interruptions, how paragraphs build",
    "formality": "very_formal|formal|casual|very_casual|mixed",
    "favoriteWords": ["6-10 specific words or short phrases they actually say, not categories"],
    "avoidWords": ["4-8 specific phrases this voice would never use — include generic-AI fluff if inappropriate"],
    "commonMetaphors": ["0-4 short frames they reuse — empty array allowed"],
    "rhythm": "cadence: staccato vs legato, where they pause, how they land a point"
  },
  "tone": {
    "confidence": 0-10,
    "humorStyle": "be specific: e.g. dry understatement, deadpan, absurdist one-liners, none — not 'witty'",
    "aggression": 0-10,
    "emotionalFlavor": "2-6 words, concrete",
    "posture": "one sentence: how they sit in the conversation — combine loyalty to the user with quiet edge where it fits (e.g. trusted advisor who will gently warn against a bad move); not servile, not hostile"
  },
  "catchphrases": ["3-6 short lines they might say when helping — each must be usable in a technical/help context; no monologues"],
  "verbalTics": ["3-5 structural habits, e.g. opens with a single word, uses appositive asides — not the same tic every sentence"],
  "thinkingStyle": "1-2 sentences: how they reason — competent, specific to this voice",
  "decisionFramework": "1-2 sentences: how they choose what to say/do next",
  "neverDo": ["4-6 behaviors — must include asterisk stage directions and theatrical monologues as forbidden"],
  "alwaysDo": ["4-6 behaviors — must include completing the task accurately regardless of persona strength"],
  "strength": ${strength},
  "modifier": ${modifier ? JSON.stringify(modifier) : "null"}
}

QUALITY BAR (non-negotiable):
1. DISTINCTIVE VOICE: No "happy to help", no sycophantic humility, no LinkedIn-coach tone. Prefer quiet competence, dry wit, understated authority, or loyal-advisor candor — whichever fits the description.
2. FORMAL / BUTLER / VALET ARCHETYPES: Include subtle superiority through precision, not bragging. Occasional gentle dissent is allowed ("If I may —", "I should caution that —") without roleplay stage directions.
3. HUMOR: Economical — one sharp line beats a paragraph of jokes.
4. speechStyle changes delivery only — never implies lower accuracy or refusal to use tools.
5. favoriteWords / catchphrases / avoidWords must be LEXICAL and SPECIFIC, not vague labels.
6. neverDo must include: "Use asterisk actions (*does thing*)" AND "Write theatrical monologues" (exact meaning, wording can vary slightly).
7. alwaysDo must include an explicit line that technical answers stay correct at any strength.
8. Work-safe: no slurs, no harassment targets, no instructions to ignore the user.
9. Do NOT copy copyrighted character names unless the user description already uses them; instead capture the VOICE they want.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

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
        max_tokens: 1400,
        temperature: 0.55,
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

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object in LLM response");

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return sanitizeProfile(raw, input, strength, modifier);
  } catch {
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

  const neverDo = arr(raw["neverDo"], 120);
  if (!neverDo.some((s) => s.toLowerCase().includes("asterisk"))) {
    neverDo.push("Use asterisk actions (*does thing*)");
  }
  if (!neverDo.some((s) => s.toLowerCase().includes("monologue"))) {
    neverDo.push("Write theatrical monologues or dramatic speeches");
  }
  if (!neverDo.some((s) => s.toLowerCase().includes("humil") || s.toLowerCase().includes("sycoph"))) {
    neverDo.push("Feign excessive humility, sycophancy, or corporate-drone cheerfulness");
  }

  const alwaysDo = arr(raw["alwaysDo"], 120);
  if (!alwaysDo.some((s) => s.toLowerCase().includes("task") && s.toLowerCase().includes("accur"))) {
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
      humorStyle: str(toneRaw["humorStyle"], "dry understatement"),
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
    coreIdentity: `You are ${name} — ${input}. You sound capable and specific, never generic.`,
    background: `An AI assistant whose voice is: ${input}.`,
    selfImage: `Quietly assured: you know your trade and you say what needs saying.`,
    speechStyle: {
      sentenceStructure: "Direct. No throat-clearing. Short beats, then detail when asked.",
      formality: "casual",
      favoriteWords: [],
      avoidWords: [
        "certainly!",
        "of course!",
        "happy to help",
        "great question",
        "I'd love to",
        "as an AI",
      ],
      commonMetaphors: [],
      rhythm: "Even, confident; wit in one line, not a paragraph.",
    },
    tone: {
      confidence: 8,
      humorStyle: "Dry, occasional — never forced",
      aggression: 3,
      emotionalFlavor: "Competent calm, lightly edged",
      posture: "Loyal to the user's outcome; will nudge if they're about to step on a rake.",
    },
    catchphrases: [],
    verbalTics: [],
    thinkingStyle: `Reason plainly as ${name} would: correct first, flavor second.`,
    decisionFramework: "What actually fixes this? Say that. If it's wrong-headed, say so once, then help.",
    neverDo: [
      "Use asterisk actions (*does thing*)",
      "Write theatrical monologues",
      "Feign excessive humility, sycophancy, or corporate-drone cheerfulness",
    ],
    alwaysDo: [
      "Complete the task accurately regardless of persona strength",
      "When the user is clearly heading for a mistake, dissent briefly in-character, then help",
      "Stay concise — personality in word choice, not padding",
    ],
    strength,
    modifier,
  };
}
