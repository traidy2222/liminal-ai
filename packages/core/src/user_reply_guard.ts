import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { TurnIntentClass } from "./intent_inference.js";

/** Any visible answer is sufficient; never expand a completed reply. */
export const MIN_USER_VISIBLE_REPLY_CHARS = 1;

/** Ephemeral system line for the finalize API call only — not persisted to context. */
export const USER_REPLY_FINALIZE_SYSTEM =
  "Tool calls for this turn have ended. Give one brief reply from their actual results: what succeeded, failed or remains incomplete. " +
  "No new work, verification or tools; do not invent success.";

export interface UserReplyFinalizeInput {
  assistantText: string;
  toolsUsed: string[];
  intent?: TurnIntentClass;
  openingTurn?: boolean;
  sessionGreeting?: boolean;
  personaBootstrap?: boolean;
  userMessage?: string;
}

/** User asked for a one-token or brief confirmation (e.g. "Reply FIXED when …"). */
export function userRequestedTerseReply(userMessage: string): string | null {
  const msg = userMessage.trim();
  if (!msg) return null;
  const whenMatch = msg.match(/\b(?:reply|say|respond(?:\s+with)?)\s+[`'"]?([A-Za-z][\w-]*)/i);
  if (whenMatch && /\bwhen\b/i.test(msg)) return whenMatch[1]!.toUpperCase();
  if (/\b(?:one|few)\s+words?\b/i.test(msg) || /\bkeep (?:it )?brief\b/i.test(msg)) return "";
  return null;
}

export function userReplyFinalizeEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_USER_REPLY_FINALIZE") !== "0";
}

/**
 * True when the harness should run one tool-free finalize completion before turn_end.
 */
export function needsUserReplyFinalization(input: UserReplyFinalizeInput): boolean {
  if (!userReplyFinalizeEnabled()) return false;
  if (input.openingTurn || input.sessionGreeting || input.personaBootstrap) {
    return false;
  }
  return !input.assistantText.trim() && input.toolsUsed.length > 0;
}
