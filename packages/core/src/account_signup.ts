/** Single-account signup is an execution task, distinct from inbox access or writing code. */
export function isAccountSignupTurn(message: string): boolean {
  const text = message.trim().toLowerCase()
    .replace(/^(?:hey|hi)\s+[\w-]+[,!:\s]+/, "")
    .replace(/^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?/, "");
  if (/\b(?:bulk|mass|spam|ban evasion|bypass|fake identity|stolen|bank|brokerage|credit card|loan|government|insurance)\b/.test(text)) return false;
  if (/\b\d+\s+(?:\w+\s+){0,3}accounts\b/.test(text)) return false;
  if (/^(?:sign\s+(?:(?:me|us|yourself)\s+)?up|sign\s*up)\b/.test(text)) return true;
  return /^(?:create|make|register|open|set\s+up)\b[^.!?\n]{0,140}\b(?:account|login)\b/.test(text);
}

const OBSERVED_BROWSER_TOOLS = new Set([
  "browser_open", "browser_snapshot", "browser_navigate", "browser_act", "browser_extract", "browser_wait_for",
]);

/** One correction only for a speculative technical refusal/permission offer before inspection. */
export function needsSignupInspection(input: {
  userMessage: string; assistantText: string; toolsUsed: readonly string[];
  browserAvailable: boolean; attempted: boolean; openingTurn: boolean;
}): boolean {
  if (input.attempted || input.openingTurn || !input.browserAvailable || !isAccountSignupTurn(input.userMessage)) return false;
  if (input.toolsUsed.some(t => OBSERVED_BROWSER_TOOLS.has(t) || t === "ask_user" || t === "connect_provider")) return false;
  return /\b(?:can(?:not|'t|’t)|unable to|requires? (?:a )?human|manually|would you like|which would you|shall I|should I|permission|confirm|do it yourself)\b/i.test(input.assistantText);
}

export const SIGNUP_INSPECTION_RECOVERY =
  "[SIGNUP INSPECTION MISSING] No browser inspection was attempted for this explicitly requested account setup. " +
  "Your previous technical limitations are unverified. Inspect the official signup flow using the available browser tools before claiming it requires a human or offering to start later. " +
  "Continue only within the requested scope and existing approval decisions; report a concrete blocker if observed. Do not evade verification or fabricate identity details.";
