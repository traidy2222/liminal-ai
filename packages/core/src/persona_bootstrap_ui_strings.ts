/**
 * Shared copy for first-run persona bootstrap (web modal + TUI overlay).
 * Keep behavior in sync with product expectations; no runtime imports.
 */

export const PERSONA_QUICK_PRESETS: readonly string[] = [
  "Calm technical writer — clear, neutral, minimal fluff.",
  "Direct senior engineer — short sentences, decisive, occasional dry humor.",
  "Patient mentor — step-by-step, encourages questions, no jargon walls.",
  "Concise analyst — dense facts, admits uncertainty, prefers evidence over hype.",
];

export function personaBootstrapStageHint(stage: string | null | undefined): string {
  if (!stage) return "";
  const labels: Record<string, string> = {
    starting: "Starting",
    skip: "Skipping",
    parsed: "Parsed",
    reset: "Resetting",
    generating: "Generating profile",
    applying: "Applying",
    persisting: "Saving",
    done: "Done",
    profile_start: "Profile",
    artifact_start: "Soul + theme",
    artifact_persist: "Saving files",
    artifact_ready: "Almost done",
    ui_theme_start: "HUD theme",
    ui_theme_ready: "Theme saved",
    soul_draft: "Soul blueprint",
    soul_scaffold: "Soul scaffold",
    controls_pass: "Controls",
  };
  return labels[stage] ?? stage;
}
