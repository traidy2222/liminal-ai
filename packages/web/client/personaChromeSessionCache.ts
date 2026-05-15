import type { PersonaUiThemeV1 } from "@liminal/core/persona-ui-theme";

/** Same-tab reload: reapply last `/api/config` persona chrome before React hydrates. */
export const PERSONA_CHROME_SESSION_KEY = "liminal:personaChrome:v1";

export function readPersonaChromeFromSession(): {
  personaUiTheme: PersonaUiThemeV1 | null;
  personaDisplayLabel: string;
} | null {
  try {
    const raw = sessionStorage.getItem(PERSONA_CHROME_SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as {
      personaUiTheme?: PersonaUiThemeV1 | null;
      personaDisplayLabel?: string;
    };
    return {
      personaUiTheme: j.personaUiTheme ?? null,
      personaDisplayLabel:
        typeof j.personaDisplayLabel === "string" && j.personaDisplayLabel.trim()
          ? j.personaDisplayLabel.trim()
          : "LIMINAL",
    };
  } catch {
    return null;
  }
}

export function writePersonaChromeToSession(
  personaUiTheme: PersonaUiThemeV1 | null,
  personaDisplayLabel: string
): void {
  try {
    sessionStorage.setItem(
      PERSONA_CHROME_SESSION_KEY,
      JSON.stringify({ personaUiTheme, personaDisplayLabel })
    );
  } catch {
    /* quota / private mode */
  }
}
