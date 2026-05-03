import type { AgentHarness } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { resolvePreset, buildPersonaBlock } from "./persona_presets.js";
import { generatePersona } from "./persona_generator.js";

/**
 * Factory: creates the set_persona tool bound to a specific harness instance.
 * Must be re-created for each child harness (hence excluded from ORCHESTRATION_TOOL_NAMES).
 *
 * Accepts either:
 *  - A preset name: "jarvis", "hal", "socrates", "hacker", "coach", "scientist", "pirate", "exec", "default"
 *  - Any natural-language description: "a formal Victorian-era scientist", "a grumpy dwarf blacksmith"
 *
 * For natural-language input, spawns a focused LLM call to generate the persona JSON.
 * The Communication Rules and operational protocols are NEVER affected by persona changes.
 */
export function createSetPersonaTool(harness: AgentHarness) {
  return defineTool({
    name: "set_persona",
    description:
      "WHAT: Change your communication style and personality inline during the conversation.\n" +
      "WHEN: The user asks you to change your personality, adopt a different style, or 'be' something.\n" +
      "NOT WHEN: The user asks you to roleplay a scenario — you change style, not behavior.\n" +
      "ARGS: input — a preset name (jarvis, hal, socrates, hacker, coach, scientist, pirate, exec, default) " +
      "or a natural-language description of the desired personality.\n" +
      "EFFECT: Your tone and vocabulary change immediately. Operational rules stay the same.\n" +
      "NOTE: Personality shows in HOW you phrase answers, never in performance or asterisk actions.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description:
            "Preset name or natural-language personality description. " +
            "Presets: jarvis, hal, socrates, hacker, coach, scientist, pirate, exec, default.",
        },
      },
      required: ["input"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = (args["input"] as string).trim();

      // 1. Try preset lookup first (fast path — no LLM call)
      const preset = resolvePreset(input);
      if (preset) {
        const block = buildPersonaBlock(preset);
        harness.setPersona(preset, block);
        return {
          ok: true,
          output:
            `Persona set to "${preset.name}". ${preset.description}. ` +
            `Communication style updated — operational protocols unchanged.`,
        };
      }

      // 2. Fall back to LLM generation
      const { openRouterApiKey, model, baseURL } = harness.config;
      if (!openRouterApiKey) {
        return {
          ok: false,
          error: "Cannot generate persona: OPENROUTER_API_KEY not configured.",
        };
      }

      try {
        const generated = await generatePersona(input, openRouterApiKey, model, baseURL);
        const block = buildPersonaBlock(generated);
        harness.setPersona(generated, block);
        return {
          ok: true,
          output:
            `Persona generated and applied: "${generated.name}". ${generated.description}. ` +
            `Communication style updated — operational protocols unchanged.`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Persona generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
