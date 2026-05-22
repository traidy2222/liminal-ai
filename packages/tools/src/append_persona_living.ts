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
      "WHAT: Append a timestamped note to `persona/active/soul/living.md` and **immediately reload** the persona block — the note takes effect on the very next model turn.\n" +
      "WHEN to write a living note (write one per meaningful observation, at turn end):\n" +
      "  • You broke character, got the tone wrong, or the output missed the mark — note what happened and how to avoid it.\n" +
      "  • The user corrected your phrasing, style, register, or approach — record the correction as an active override.\n" +
      "  • A specific rhythm, technique, or framing got strong positive engagement — note it so this persona repeats it.\n" +
      "  • You discovered how this user prefers to receive information: length, directness, formality, detail level.\n" +
      "  • A recurring theme, project thread, or context this persona should carry across sessions.\n" +
      "  • You found a reasoning approach that works especially well for this persona + task type.\n" +
      "  • This persona's relationship with the user has a dynamic worth preserving (collaborative, challenging, playful, etc.).\n" +
      "NOT WHEN: The fact is about the user, project, or world — use remember / vault tools. Do NOT use raw write_file on soul files; it will not reload the harness.\n\n" +
      "EFFECT: Disk append + persona block reload. Living notes are **active operating corrections** — they override the static soul slices for the dimensions they address.",
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
