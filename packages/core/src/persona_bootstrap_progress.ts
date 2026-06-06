/**
 * Structured progress for persona bootstrap / generation (web SSE + TUI).
 */

export type PersonaArtifactId =
  | "runtime_profile"
  | "soul_identity"
  | "soul_voice"
  | "soul_stance"
  | "soul_rails"
  | "ui_theme"
  | "ui_copy";

export type PersonaArtifactStatus = "pending" | "streaming" | "done" | "error";

export interface PersonaArtifactPreview {
  id: PersonaArtifactId;
  label: string;
  status: PersonaArtifactStatus;
  content: string;
  charCount?: number;
  incomplete?: boolean;
}

export interface PersonaProgressDetail {
  artifacts?: PersonaArtifactPreview[];
}

export interface PersonaBootstrapProgressEvent {
  stage: string;
  message: string;
  at: number;
  artifacts?: PersonaArtifactPreview[];
}

export const PERSONA_ARTIFACT_LABELS: Record<PersonaArtifactId, string> = {
  runtime_profile: "runtime_profile.json",
  soul_identity: "soul/identity.md",
  soul_voice: "soul/voice.md",
  soul_stance: "soul/stance.md",
  soul_rails: "soul/rails.md",
  ui_theme: "ui_theme.json",
  ui_copy: "ui_copy.json",
};

export const PERSONA_ARTIFACT_ORDER: readonly PersonaArtifactId[] = [
  "runtime_profile",
  "soul_identity",
  "soul_voice",
  "soul_stance",
  "soul_rails",
  "ui_theme",
  "ui_copy",
];
