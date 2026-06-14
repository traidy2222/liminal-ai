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

const FILE_MUTATE_TOOLS = new Set([
  "read_file",
  "edit_file",
  "write_file",
  "multi_file_apply",
  "file_metadata",
]);

function isFileMutateOnlyTurn(toolsUsed: string[]): boolean {
  return (
    toolsUsed.length >= 2 && toolsUsed.every((t) => FILE_MUTATE_TOOLS.has(t))
  );
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
  if (input.userMessage) {
    const terseToken = userRequestedTerseReply(input.userMessage);
    if (terseToken !== null && assistant.length > 0) {
      if (!terseToken) return false;
      if (new RegExp(`\\b${terseToken}\\b`, "i").test(assistant)) return false;
    }
  }
  if (
    isFileMutateOnlyTurn(input.toolsUsed) &&
    assistant.length >= 4 &&
    (input.intent === "coding" || input.intent === "execution" || !input.intent)
  ) {
    return false;
  }
  const minChars =
    input.intent === "coding" || input.intent === "execution"
      ? 20
      : MIN_USER_VISIBLE_REPLY_CHARS;
  if (assistant.length >= minChars) {
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
