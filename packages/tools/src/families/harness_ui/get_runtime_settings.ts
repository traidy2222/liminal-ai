import type { AgentHarness } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

/**
 * Harness-scoped read tool for inspecting effective runtime settings.
 * Keeps "check current setting" separate from mutating tools.
 */
export function createGetRuntimeSettingsTool(harness: AgentHarness) {
  return defineTool({
    name: "get_runtime_settings",
    description:
      "WHAT: Read current effective runtime settings (including persona controls).\n" +
      "WHEN: User asks to check current humor/formality/confidence/verbosity/strength or general runtime prefs.\n" +
      "NOT WHEN: You need to change settings; use set_runtime_settings or set_persona.\n" +
      "ARGS: optional fields filter to reduce output: 'all' (default), 'persona_controls', 'provider', or 'runtime'.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "string",
          enum: ["all", "persona_controls", "provider", "runtime"],
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const fields = (args["fields"] as string | undefined) ?? "all";
      const prefs = harness.getRuntimePreferences();
      if (!prefs) {
        return { ok: true, output: "(no runtime settings loaded)" };
      }
      if (fields === "persona_controls") {
        return {
          ok: true,
          output: JSON.stringify(
            {
              persona_controls: prefs.persona?.controls ?? {},
              updatedAt: prefs.persona?.updatedAt ?? null,
            },
            null,
            2
          ),
        };
      }
      if (fields === "provider") {
        return { ok: true, output: JSON.stringify({ provider: prefs.provider ?? {} }, null, 2) };
      }
      if (fields === "runtime") {
        return { ok: true, output: JSON.stringify({ runtime: prefs.runtime ?? {} }, null, 2) };
      }
      return { ok: true, output: JSON.stringify(prefs, null, 2) };
    },
  });
}

