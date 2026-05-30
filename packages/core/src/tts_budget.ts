/**
 * Per-turn TTS budget — caps speak() calls and spacing between clips.
 */
import type { SpeechSynthesisConfig } from "./speech_synthesis.js";
import { sanitizeTextForTts } from "./speech_synthesis.js";

export interface TtsBudgetConsumeResult {
  ok: boolean;
  sanitizedText?: string;
  reason?: string;
}

export class TtsTurnBudget {
  private callsUsed = 0;
  private lastSpokeAtMs = 0;
  private readonly recentNormalized: string[] = [];
  private readonly maxRecent = 12;

  reset(): void {
    this.callsUsed = 0;
    this.lastSpokeAtMs = 0;
    this.recentNormalized.length = 0;
  }

  tryConsume(text: string, config: SpeechSynthesisConfig, nowMs = Date.now()): TtsBudgetConsumeResult {
    if (!config.enabled) {
      return { ok: false, reason: "TTS disabled (AGENT_TTS_ENABLED=0)." };
    }
    if (this.callsUsed >= config.maxCallsPerTurn) {
      return {
        ok: false,
        reason: `TTS per-turn call cap reached (${config.maxCallsPerTurn}).`,
      };
    }
    const sanitized = sanitizeTextForTts(text, config.maxCharsPerCall);
    if (!sanitized) {
      return { ok: false, reason: "Nothing to speak after sanitization." };
    }
    const norm = normalizeForDedupe(sanitized);
    const lastNorm = this.recentNormalized[this.recentNormalized.length - 1];
    const substantialContinuation =
      lastNorm != null && norm.length > lastNorm.length * 1.12 && norm.includes(lastNorm);
    if (
      !substantialContinuation &&
      this.recentNormalized.some((r) => isNearDuplicateSpokenLine(r, norm))
    ) {
      return { ok: false, reason: "Duplicate or near-duplicate spoken line skipped." };
    }
    if (
      !substantialContinuation &&
      this.lastSpokeAtMs > 0 &&
      config.minIntervalMs > 0 &&
      nowMs - this.lastSpokeAtMs < config.minIntervalMs
    ) {
      return {
        ok: false,
        reason: `TTS min interval (${config.minIntervalMs}ms) not elapsed.`,
      };
    }
    this.callsUsed += 1;
    this.lastSpokeAtMs = nowMs;
    this.recentNormalized.push(norm);
    if (this.recentNormalized.length > this.maxRecent) {
      this.recentNormalized.shift();
    }
    return { ok: true, sanitizedText: sanitized };
  }

  get callsThisTurn(): number {
    return this.callsUsed;
  }
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact repeat only, or same-length paraphrase — not a longer continuation clip. */
export function isNearDuplicateSpokenLine(previous: string, next: string): boolean {
  if (previous === next) return true;
  const shorter = previous.length <= next.length ? previous : next;
  const longer = previous.length <= next.length ? next : previous;
  if (!shorter || !longer.includes(shorter)) return false;
  return longer.length < shorter.length * 1.15;
}
