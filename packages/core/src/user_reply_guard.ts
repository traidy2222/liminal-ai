import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { TurnIntentClass } from "./intent_inference.js";

/** Minimum substantive assistant chars before we accept turn end after tool work. */
export const MIN_USER_VISIBLE_REPLY_CHARS = 72;

/** Ephemeral system line for the finalize API call only — not persisted to context. */
export const USER_REPLY_FINALIZE_SYSTEM =
  "Tool work for this user turn is complete. Write your reply to the user now, using evidence already in context. " +
  "Do not call tools in this message.";

const RESEARCH_TOOL_NAMES = new Set([
  "web_search",
  "web_fetch",
  "vault_write",
  "vault_ingest",
  "vault_ingest_entities",
  "remember",
  "memory_query",
  "recall_relevant",
]);

export interface UserReplyFinalizeInput {
  assistantText: string;
  toolsUsed: string[];
  intent?: TurnIntentClass;
  openingTurn?: boolean;
  sessionGreeting?: boolean;
  personaBootstrap?: boolean;
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
  const assistant = input.assistantText.trim();
  if (assistant.length >= MIN_USER_VISIBLE_REPLY_CHARS) {
    return false;
  }
  if (input.toolsUsed.length === 0) {
    return false;
  }

  const intent = input.intent ?? "knowledge";
  const usedResearchTools = input.toolsUsed.some((t) => RESEARCH_TOOL_NAMES.has(t));
  if (intent === "research" || intent === "knowledge") {
    return usedResearchTools || input.toolsUsed.length >= 2;
  }
  return input.toolsUsed.length >= 2;
}
