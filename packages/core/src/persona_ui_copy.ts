/**
 * Persona UI copy — the persona's voice extended into the app's own interface text.
 *
 * Colors and layout make the app *look* like the persona; this makes it *read*
 * like the persona. A noir analyst's composer says "State your query.", not
 * "Type a message…". These are model-authored at bootstrap, persisted as a
 * `ui_copy.json` artifact, and sanitized here: every field is length-clamped,
 * control-char/markup-stripped, and falls back to a neutral default when the
 * model omits it or emits garbage. Presentation text only — never interpreted.
 */

export interface PersonaUiCopy {
  v: 1;
  /** Placeholder shown in the empty composer input. */
  composerPlaceholder: string;
  /** Label/tooltip for the send action. */
  sendLabel: string;
  /** Label/tooltip for the stop-generation action. */
  stopLabel: string;
  /** Title shown on a fresh, empty conversation. */
  emptyTitle: string;
  /** One-line body under the empty-state title. */
  emptyBody: string;
  /** Status text while the agent is thinking/streaming. */
  thinkingLabel: string;
  /** Status text while connecting to the sidecar. */
  connectingLabel: string;
  /** Short prefix prepended to surfaced error lines. */
  errorPrefix: string;
  /** Label for the "new chat" affordance. */
  newChatLabel: string;
}

export const DEFAULT_PERSONA_UI_COPY: PersonaUiCopy = {
  v: 1,
  composerPlaceholder: "Type a message…",
  sendLabel: "Send",
  stopLabel: "Stop",
  emptyTitle: "Ready when you are",
  emptyBody: "Ask anything, or start with a task.",
  thinkingLabel: "Thinking…",
  connectingLabel: "Connecting…",
  errorPrefix: "Something went wrong",
  newChatLabel: "New chat",
};

/** Per-field max lengths after sanitization. Keeps chrome from overflowing. */
const COPY_MAX: Record<keyof Omit<PersonaUiCopy, "v">, number> = {
  composerPlaceholder: 80,
  sendLabel: 18,
  stopLabel: 18,
  emptyTitle: 60,
  emptyBody: 140,
  thinkingLabel: 28,
  connectingLabel: 28,
  errorPrefix: 48,
  newChatLabel: 24,
};

const COPY_FIELDS = Object.keys(COPY_MAX) as Array<keyof typeof COPY_MAX>;

function sanitizeCopyField(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  // Strip control chars (\x00-\x1f) and angle brackets so no markup leaks into
  // chrome; collapse whitespace, trim, clamp length, fall back when empty.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw
    .replace(/[\x00-\x1f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

/** Merge untrusted model output with defaults; safe for persisted artifacts. */
export function sanitizePersonaUiCopy(raw: unknown): PersonaUiCopy {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { v: 1 } as PersonaUiCopy;
  for (const field of COPY_FIELDS) {
    out[field] = sanitizeCopyField(o[field], COPY_MAX[field], DEFAULT_PERSONA_UI_COPY[field]);
  }
  return out;
}

/** True when copy is just the neutral defaults (no persona voice applied). */
export function isDefaultPersonaUiCopy(copy: PersonaUiCopy): boolean {
  return COPY_FIELDS.every((f) => copy[f] === DEFAULT_PERSONA_UI_COPY[f]);
}
