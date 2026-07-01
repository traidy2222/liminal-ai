import type { LedgerSummary } from "./research_ledger.js";
import { isResearchFreshnessUserMessage } from "./reasoning_surface.js";
import type { TurnIntentClass } from "./intent_inference.js";

export const BRIEF_RESEARCH_RE =
  /\b(brief|quick|tldr|tl;dr|short answer|one paragraph|2 sentence|two sentence|just a (quick )?summary)\b/i;

export function isBriefResearchAsk(userMessage: string): boolean {
  return BRIEF_RESEARCH_RE.test(userMessage.trim());
}

export function isActiveResearchSend(input: {
  intent?: TurnIntentClass | null;
  freshnessSensitive?: boolean;
  toolFirstBias?: boolean;
  userMessage: string;
}): boolean {
  if (isBriefResearchAsk(input.userMessage)) return false;
  const msg = input.userMessage.trim();
  if (!msg) return false;
  return (
    input.intent === "research" ||
    (input.intent === "knowledge" &&
      (input.freshnessSensitive === true || isResearchFreshnessUserMessage(msg))) ||
    (input.freshnessSensitive === true && input.toolFirstBias === true)
  );
}

/**
 * Minimum assistant reply length (chars) that signals the model already committed
 * to a substantive answer. When the reply exceeds this threshold the research
 * continuation gate will NOT fire — the model intentionally stopped researching.
 */
export const RESEARCH_GATE_SUBSTANTIVE_REPLY_CHARS = 150;

export interface ResearchContinuationInput {
  userMessage: string;
  intent?: TurnIntentClass | null;
  freshnessSensitive?: boolean;
  toolFirstBias?: boolean;
  toolsUsed: string[];
  summary: LedgerSummary;
  pendingUrlSamples?: string[];
  gateAttempted: boolean;
  enabled?: boolean;
  /** The assistant's accumulated text response this turn. */
  assistantText?: string;
}

export function researchCoverageLooksThin(summary: LedgerSummary): boolean {
  const { searchCount, fetchedOk, pending, urlInventoryCount } = summary;
  if (pending >= 3) return true;
  if (searchCount >= 1 && fetchedOk < 2 && pending >= 1) return true;
  if (searchCount === 1 && fetchedOk <= 1 && urlInventoryCount >= 3) return true;
  if (searchCount >= 2 && fetchedOk < searchCount && pending >= 2) return true;
  return false;
}

export function buildResearchContinuationNudge(input: {
  summary: LedgerSummary;
  pendingSample: string[];
}): string {
  const { summary, pendingSample } = input;
  const pendingLines =
    pendingSample.length > 0
      ? pendingSample.map((u) => `  • ${u}`).join("\n")
      : "  (call research_state view=pending for the full list)";
  return (
    "[RESEARCH CONTINUATION] Coverage is still thin for this ask — do not finalize yet.\n" +
    `Ledger: searches=${summary.searchCount} fetched_ok=${summary.fetchedOk} pending=${summary.pending} urls=${summary.urlInventoryCount}\n` +
    "Expert pattern: diversify web_search intents (background · latest status · primary sources · dissent), " +
    "then web_fetch several independent pending URLs in parallel — not just the first hit.\n" +
    "Call research_state before synthesizing. Cross-check key claims across source tiers (R-CITE-QUALITY).\n" +
    `High-value pending URLs (sample):\n${pendingLines}\n` +
    "Continue with tools until coverage matches the ask and [OUTPUT EFFORT], or document explicit gaps under R-KNOWN-UNKNOWNS."
  );
}

/**
 * Block turn-end once when web research started but the ledger still looks shallow.
 */
export function needsResearchContinuation(
  input: ResearchContinuationInput
): { needed: true; message: string } | { needed: false } {
  if (input.enabled === false) return { needed: false };
  if (input.gateAttempted) return { needed: false };
  if (isBriefResearchAsk(input.userMessage)) return { needed: false };

  // If the model already wrote a substantive reply, it intentionally stopped
  // researching — respect that decision instead of forcing more rounds.
  if (
    input.assistantText &&
    input.assistantText.trim().length >= RESEARCH_GATE_SUBSTANTIVE_REPLY_CHARS
  ) {
    return { needed: false };
  }

  const usedWeb =
    input.toolsUsed.includes("web_search") || input.toolsUsed.includes("web_fetch");
  if (!usedWeb) return { needed: false };

  const researchTurn = isActiveResearchSend({
    intent: input.intent,
    freshnessSensitive: input.freshnessSensitive,
    toolFirstBias: input.toolFirstBias,
    userMessage: input.userMessage,
  });
  if (!researchTurn && input.summary.searchCount === 0) return { needed: false };

  if (!researchCoverageLooksThin(input.summary)) return { needed: false };

  const pendingSample = (input.pendingUrlSamples ?? []).slice(0, 5);
  return {
    needed: true,
    message: buildResearchContinuationNudge({
      summary: input.summary,
      pendingSample,
    }),
  };
}
