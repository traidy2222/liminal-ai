/**
 * Detect short user continuations ("go ahead", "yes", "do it") and inject a
 * generic harness nudge — not tied to any tool family.
 */

export function isShortContinuationTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 160) return false;
  return (
    /\b(go ahead|proceed|continue|do it|do that|looks good|lgtm|approved|yes please)\b/i.test(
      t
    ) || /^(yes|yep|yeah|ok|okay|sure|send|go)\.?$/i.test(t)
  );
}

export const CONTINUATION_TURN_INJECTION =
  "[CONTINUATION] User wants you to proceed. Do not repeat tool work that already succeeded in this chat — " +
  "use prior tool results or the natural follow-up step. Continue with the next item from the original request.";
