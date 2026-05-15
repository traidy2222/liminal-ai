import type { AgentHarness, RuntimePersonaControls } from "@liminal/core";
import { defineTool } from "./helpers.js";

function controlsSummary(controls: RuntimePersonaControls): string {
  const parts: string[] = [];
  if (controls.humorPercent != null) parts.push(`humor=${controls.humorPercent}%`);
  if (controls.formality) parts.push(`formality=${controls.formality}`);
  if (controls.confidence != null) parts.push(`confidence=${controls.confidence}/10`);
  if (controls.verbosity) parts.push(`verbosity=${controls.verbosity}`);
  if (controls.personaStrength != null) parts.push(`strength=${controls.personaStrength}/10`);
  return parts.join(", ");
}

/**
 * Harness-scoped settings tool for persona/runtime tuning.
 * Focused on core persona controls so the model can self-calibrate style.
 */
export function createSetRuntimeSettingsTool(harness: AgentHarness) {
  return defineTool({
    name: "set_runtime_settings",
    description:
      "WHAT: Update persistent runtime settings, especially core persona controls (humor/formality/confidence/verbosity/strength).\n" +
      "WHEN: User asks to tune style dynamically (e.g. 'humor 23%', 'more formal', 'less verbose').\n" +
      "NOT WHEN: You need a brand new persona identity archetype; use set_persona for that.\n" +
      "ARGS: persona_controls object with optional fields; persist defaults true.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        persona_controls: {
          type: "object",
          properties: {
            humorPercent: { type: "number", minimum: 0, maximum: 100 },
            formality: {
              type: "string",
              enum: ["very_formal", "formal", "casual", "very_casual", "mixed"],
            },
            confidence: { type: "number", minimum: 0, maximum: 10 },
            verbosity: { type: "string", enum: ["compact", "normal", "detailed"] },
            personaStrength: { type: "number", minimum: 1, maximum: 10 },
          },
        },
        persist: {
          type: "boolean",
          description: "Persist to .agent_runtime_prefs.json (default: true).",
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const controls = (args["persona_controls"] as RuntimePersonaControls | undefined) ?? {};
      if (Object.keys(controls).length === 0) {
        return { ok: false, error: "No settings provided. Pass persona_controls with at least one field." };
      }
      const persist = args["persist"] !== false;
      const out = await harness.patchRuntimePreferences(
        {
          persona: {
            controls,
            updatedAt: Date.now(),
          },
        },
        { persist }
      );
      const effectiveControls = harness.getRuntimePreferences()?.persona?.controls ?? {};
      const summary = controlsSummary(controls);
      const effectiveSummary = controlsSummary(effectiveControls);
      return {
        ok: true,
        output:
          `Runtime settings updated: ${summary || "persona controls"}.\n` +
          `Effective controls now: ${effectiveSummary || "(none)"}.\n` +
          `Persistence: ${out.persisted ? "persisted" : "session-only"}.`,
      };
    },
  });
}

