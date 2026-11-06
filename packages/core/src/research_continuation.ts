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

/** URL inventory counts are not evidence of whether a question has been answered. */
export function researchCoverageLooksThin(_summary: LedgerSummary): boolean { return false; }

export function buildResearchContinuationNudge(_input: {summary: LedgerSummary; pendingSample: string[]}): string {
  return "[RESEARCH CONTINUATION] No answer text was produced after web tools. Answer the user's question from the evidence already obtained, or identify the specific missing fact. Fetch more only if that gap requires it.";
}

export function needsResearchContinuation(input: ResearchContinuationInput): {needed:true;message:string}|{needed:false} {
  if(input.enabled===false || input.gateAttempted || input.assistantText?.trim()) return {needed:false};
  if(!input.toolsUsed.some(tool=>tool==='web_search'||tool==='web_fetch')) return {needed:false};
  return {needed:true,message:buildResearchContinuationNudge({summary:input.summary,pendingSample:[]})};
}
