import type { AgentHarness } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { resolvePreset, buildRichPersonaBlock, type PersonaProfile } from "./persona_presets.js";
import { generatePersonaProfile } from "./persona_generator.js";
import { atomicUpdate } from "./notes_store.js";

// ─── Input parser ─────────────────────────────────────────────────────────────

interface ParsedInput {
  coreInput: string;
  strength: number;
  modifier?: string;
}

/**
 * Parse a set_persona input string for strength and modifier directives.
 *
 * Supported formats:
 *   "trump"                        → coreInput="trump", strength=8
 *   "trump 9"                      → coreInput="trump", strength=9
 *   "trump strength:7"             → coreInput="trump", strength=7
 *   "trump but more technical"     → coreInput="trump", modifier="more technical"
 *   "trump 9 but less aggressive"  → coreInput="trump", strength=9, modifier="less aggressive"
 *   "sarcastic hacker"             → coreInput="sarcastic hacker", strength=8
 */
function parsePersonaInput(input: string): ParsedInput {
  let text = input.trim();
  let strength = 8;
  let modifier: string | undefined;

  // Extract "but ..." modifier (case-insensitive, anywhere after the first word)
  const butMatch = text.match(/\s+but\s+(.+)$/i);
  if (butMatch) {
    modifier = butMatch[1].trim();
    text = text.slice(0, text.length - butMatch[0].length).trim();
  }

  // Extract explicit "strength:N" or "strength N"
  const strengthExplicit = text.match(/\bstrength[:\s]+(\d{1,2})\b/i);
  if (strengthExplicit) {
    const n = parseInt(strengthExplicit[1], 10);
    if (n >= 1 && n <= 10) strength = n;
    text = text.replace(strengthExplicit[0], "").trim();
  } else {
    // Extract trailing single digit (e.g. "trump 9")
    const trailingDigit = text.match(/\s+([1-9]|10)$/);
    if (trailingDigit) {
      strength = parseInt(trailingDigit[1], 10);
      text = text.slice(0, text.length - trailingDigit[0].length).trim();
    }
  }

  return { coreInput: text, strength, modifier };
}

// ─── Memory persistence ───────────────────────────────────────────────────────

const PERSONA_MEMORY_KEY = "persona:active_profile";
const PERSONA_NAME_KEY = "persona:active_name";

async function persistPersona(profile: PersonaProfile): Promise<void> {
  await atomicUpdate((notes) => ({
    ...notes,
    [PERSONA_MEMORY_KEY]: JSON.stringify(profile),
    [PERSONA_NAME_KEY]: profile.name,
  }));
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

/**
 * Factory: creates the set_persona tool bound to a specific harness instance.
 *
 * Usage:
 *   set_persona("trump")                         → Trump preset at strength 8
 *   set_persona("trump 9")                       → Trump at strength 9
 *   set_persona("trump but more technical")      → Trump + technical modifier
 *   set_persona("gordon ramsay 7")               → Ramsay at strength 7
 *   set_persona("deadpool")                      → Deadpool preset
 *   set_persona("sarcastic Victorian scientist") → LLM-generated persona
 *   set_persona("default")                       → Reset to default Liminal persona
 *
 * Presets: trump, ramsay, deadpool, elon, hacker, professor, jarvis, hal,
 *          socrates, pirate, exec, coach, scientist, default
 */
export function createSetPersonaTool(harness: AgentHarness) {
  return defineTool({
    name: "set_persona",
    description:
      "WHAT: Change your communication style and personality inline during the conversation.\n" +
      "WHEN: The user asks you to change your personality, adopt a different style, or be someone.\n" +
      "NOT WHEN: The user asks you to roleplay a scenario — persona changes STYLE, not task behavior.\n\n" +
      "ARGS:\n" +
      "  input — preset name, alias, or natural-language description.\n\n" +
      "PRESETS (instant, no LLM call needed):\n" +
      "  trump, ramsay, gordon ramsay, deadpool, elon, elon musk, hacker,\n" +
      "  professor, jarvis, hal, socrates, pirate, exec, coach, scientist, default\n\n" +
      "MODIFIERS: append 'but ...' to adjust — e.g. 'trump but more technical'\n" +
      "STRENGTH: append 1-10 — e.g. 'ramsay 9' or 'trump strength:6'\n\n" +
      "EFFECT: Tone and vocabulary change immediately. Operational rules are unchanged.\n" +
      "Persona persists across turns and is saved to session memory.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description:
            "Preset name (trump, ramsay, deadpool, elon, hacker, professor, jarvis, hal, " +
            "socrates, pirate, exec, coach, scientist, default) or any natural-language description. " +
            "Append a number 1-10 for strength, 'but ...' for modifiers.",
          minLength: 1,
        },
      },
      required: ["input"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { coreInput, strength, modifier } = parsePersonaInput(args["input"] as string);

      let profile: PersonaProfile;

      // ── 1. Try preset lookup (fast path) ───────────────────────────────────
      const preset = resolvePreset(coreInput);
      if (preset) {
        // Apply runtime overrides to the preset
        profile = {
          ...preset,
          strength,
          modifier: modifier ?? preset.modifier,
        };
      } else {
        // ── 2. LLM generation fallback ──────────────────────────────────────
        const { openRouterApiKey, model, baseURL } = harness.config;
        if (!openRouterApiKey) {
          return {
            ok: false,
            error:
              "Cannot generate persona: OPENROUTER_API_KEY not configured. " +
              `Use a preset instead: trump, ramsay, deadpool, elon, hacker, professor, jarvis, hal, ` +
              `socrates, pirate, exec, coach, scientist.`,
          };
        }

        try {
          profile = await generatePersonaProfile(
            coreInput,
            strength,
            modifier,
            openRouterApiKey,
            model,
            baseURL
          );
        } catch (err) {
          return {
            ok: false,
            error: `Persona generation failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      // ── 3. Build the rich system-prompt block ──────────────────────────────
      const block = buildRichPersonaBlock(profile);

      // ── 4. Apply to harness ───────────────────────────────────────────────
      harness.setPersona(
        { name: profile.name, description: profile.coreIdentity },
        block
      );

      // ── 5. Persist to memory (survives session; shows in world context) ───
      try {
        await persistPersona(profile);
      } catch {
        // Non-fatal — persona is applied even if memory write fails
      }

      // ── 6. Build confirmation message ────────────────────────────────────
      const sourceLabel = preset ? "preset" : "generated";
      const modifierNote = profile.modifier ? ` (modifier: "${profile.modifier}")` : "";
      const strengthNote =
        profile.strength >= 9
          ? "maximum commitment"
          : profile.strength >= 7
          ? "strong"
          : profile.strength >= 5
          ? "moderate"
          : "subtle";

      return {
        ok: true,
        output:
          `Persona applied: ${profile.name} [${sourceLabel}, strength ${profile.strength}/10 — ${strengthNote}]${modifierNote}.\n` +
          `${profile.coreIdentity}\n` +
          `Operational rules unchanged. Tone and vocabulary updated immediately.`,
      };
    },
  });
}
