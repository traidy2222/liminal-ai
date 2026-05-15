import type { AgentHarness } from "@liminal/core";
import { defineTool } from "./helpers.js";
import type { PersonaProfile } from "./persona_presets.js";
import {
  PERSONA_LIVING_MAX_APPEND_CHARS,
  appendPersonaLivingSection,
  applyPersonaProfileToHarness,
  loadPersonaProfileFromWorkspace,
} from "./persona_runtime.js";

/**
 * Harness-scoped: append bounded markdown to `persona/active/soul/living.md` and reload the persona block from disk + profile.
 */
export function createAppendPersonaLivingTool(harness: AgentHarness) {
  return defineTool({
    name: "append_persona_living",
    description:
      "WHAT: Append a short, timestamped note to the harness-managed persona living file (`persona/active/soul/living.md`) and **reload** the in-memory persona block so the change applies on the next model turn.\n" +
      "WHEN: You learned something **about how this persona should sound or behave** that belongs in persona-local memory (voice habits, tone wins), not user-factual memory.\n" +
      "NOT WHEN: The fact is about the user, project, or world — use remember / vault tools instead. Do **not** use raw write_file on soul files; it will not refresh the harness context.\n\n" +
      "ARGS:\n" +
      "  note — markdown or plain text (required). Max length per call is bounded by the tool schema.\n\n" +
      "EFFECT: Disk append + `applyPersonaProfileToHarness` using runtime prefs profile or `runtime_profile.json` on disk.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Persona-local learning to append (markdown allowed).",
          minLength: 1,
          maxLength: PERSONA_LIVING_MAX_APPEND_CHARS + 400,
        },
      },
      required: ["note"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const note = String(args["note"] ?? "");
      const appendRes = await appendPersonaLivingSection(note);
      if (!appendRes.ok) {
        return { ok: false, error: appendRes.error ?? "append failed" };
      }
      const fromPrefs = harness.getPersistedPersonaProfile() as PersonaProfile | undefined;
      const fromDisk = await loadPersonaProfileFromWorkspace();
      const profile = (fromPrefs ?? fromDisk) ?? null;
      if (!profile) {
        return {
          ok: false,
          error:
            "Living file was updated but persona could not reload: no `activeProfile` in runtime prefs and no `persona/active/runtime_profile.json`. Run set_persona to establish a profile.",
        };
      }
      await applyPersonaProfileToHarness(harness, profile);
      const tail =
        appendRes.trimmedHead === true
          ? " Older head content of living.md was trimmed to stay under the file size cap."
          : "";
      return {
        ok: true,
        output: `Appended living note (${appendRes.appendedChars} chars; file ~${appendRes.fileCharsAfter} chars). Persona block reloaded from disk.${tail}`,
      };
    },
  });
}
