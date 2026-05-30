/**
 * Harness turn injections when the mic session is armed (voice conversation).
 * Text-only chat (mic off) does not load speak() or these injections.
 */
export const LIVE_DICTATION_TURN_INJECTION =
  "[VOICE MODE — mic on] The user is in a spoken conversation with you. They are listening, not reading a long essay.\n\n" +
  "Required:\n" +
  "- Use **speak()** for what you would say aloud: open with a brief cue when useful, and **always speak again after tool work** with findings/outcome (full answer in one or more speak() calls; up to ~4096 chars each).\n" +
  "- Put conversational substance in speak(); avoid generic filler (\"searching…\", \"one moment\") unless you immediately follow with real content.\n" +
  "- Written reply: short transcript-style text (bullets OK). Do not paste the same words verbatim in both channels.\n\n" +
  "Forbidden: echoing their words back; speaking code blocks, tool JSON, or harness trace.";

export const LIVE_DICTATION_SPEAK_NUDGE =
  "[VOICE MODE] You have not called speak() yet this turn. Call speak() now with what you would say aloud to the user, then continue tools or the short written reply.";

export const LIVE_DICTATION_AFTER_TOOLS_NUDGE =
  "[VOICE MODE] You finished tool work this turn but have not called speak() yet. Call speak() now with what you would tell the user aloud (results, outcome, next step), then your short written reply.";
