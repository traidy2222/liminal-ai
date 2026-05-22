import type { PersonaUiToolCards } from "@liminal/core/persona-ui-theme";

export type ToolSurface = "clean" | "verbose";

/**
 * Persona themes may set toolCards=hidden for minimal shells; the main transcript
 * should still show tool activity inline (compact cards) unless RAW/verbose is on.
 */
export function resolveToolCardsMode(
  personaMode: PersonaUiToolCards | undefined,
  surface: ToolSurface
): PersonaUiToolCards {
  if (surface === "verbose") return "verbose";
  const mode = personaMode ?? "verbose";
  if (mode === "hidden") return "compact";
  return mode;
}
