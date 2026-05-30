/**
 * Output-effort dial — a user-controlled setting that governs how much work the
 * model puts into its DELIVERABLE (completeness, edge-case coverage, depth,
 * polish), expressed as a system-prompt directive.
 *
 * This is a SEPARATE axis from reasoning (reasoning_profile.ts /
 * reasoning_surface.ts / the `reasoning.effort` API param). Reasoning is
 * internal deliberation depth; effort is how thorough the produced answer is.
 * This module shares nothing with the reasoning system by design — do not
 * couple them.
 *
 * It is a fixed user setting (`AGENT_EFFORT`), not a per-turn inference, read at
 * prompt-build time so a Settings change takes effect immediately.
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export type EffortLevel = "low" | "medium" | "high" | "xhigh";

const EFFORT_SET = new Set<EffortLevel>(["low", "medium", "high", "xhigh"]);

export const DEFAULT_EFFORT_LEVEL: EffortLevel = "medium";

/** Parse an arbitrary value into an EffortLevel, or null when invalid. */
export function parseEffortLevel(value: unknown): EffortLevel | null {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (EFFORT_SET.has(v as EffortLevel)) return v as EffortLevel;
  }
  return null;
}

/** Resolve the active output-effort level from `AGENT_EFFORT` (default `medium`). */
export function resolveEffortLevel(): EffortLevel {
  return parseEffortLevel(effectiveHarnessEnvRaw("AGENT_EFFORT")) ?? DEFAULT_EFFORT_LEVEL;
}

/** Per-level deliverable contracts. Output-shaped and concrete — not "try harder". */
const EFFORT_CONTRACTS: Record<EffortLevel, string> = {
  low:
    "Level low — Answer the literal request and stop. No preamble, caveats, or " +
    "alternatives. Give the shortest correct response and the minimal code (only " +
    "what was asked). Do not anticipate follow-ups.",
  medium:
    "Level medium — Address the request fully with brief rationale for non-obvious " +
    "choices; note only major caveats. Complete but not exhaustive.",
  high:
    "Level high — Deliver thorough work: complete implementations (no sketches or " +
    "TODOs), handle the obvious edge cases, briefly justify key decisions, flag " +
    "important risks or alternatives, and anticipate the likely next question.",
  xhigh:
    "Level xhigh — Exhaustive and production-grade: cover edge cases and failure " +
    "modes, state assumptions, give alternatives with their tradeoffs, and leave no " +
    "obvious follow-up unaddressed. Still substance over length.",
};

const EFFORT_FRAMING =
  "[OUTPUT EFFORT] governs how much work goes into the DELIVERABLE — depth, " +
  "completeness, edge-case coverage, polish. It is independent of internal " +
  "reasoning depth (R-REASONING). Higher effort means more substance and " +
  "coverage, never padding or filler prose.";

/** Build the system-prompt block for the active effort level (only that level's contract). */
export function buildEffortDirective(level: EffortLevel): string {
  return `${EFFORT_FRAMING}\n${EFFORT_CONTRACTS[level]}`;
}

const EFFORT_COMPLETION_MULTIPLIER: Record<EffortLevel, number> = {
  low: 0.75,
  medium: 1,
  high: 1.25,
  xhigh: 1.5,
};

const LOW_EFFORT_COMPLETION_FLOOR = 1024;

/**
 * Scale a resolved completion cap (routing or AGENT_MAX_COMPLETION_TOKENS) by output effort.
 * Applied after routing/env resolution in AgentHarness.streamWithRetry.
 */
export function scaleMaxCompletionTokensForEffort(
  base: number,
  level: EffortLevel = resolveEffortLevel()
): number {
  if (!Number.isFinite(base) || base <= 0) return base;
  const scaled = Math.round(base * EFFORT_COMPLETION_MULTIPLIER[level]);
  if (level === "low") {
    return Math.max(LOW_EFFORT_COMPLETION_FLOOR, scaled);
  }
  return scaled;
}

/** Harness trace line for round-0 observability. */
export function formatOutputEffortTraceLine(level: EffortLevel = resolveEffortLevel()): string {
  return `[output_effort: level=${level}]\n`;
}

/**
 * Per-turn system injection (authoritative for AGENT_EFFORT). Includes conflict overrides
 * so high/xhigh deliverable thoroughness is not undercut by R-EXECUTIVE-READ brevity rules.
 */
export function buildEffortTurnInjection(level: EffortLevel = resolveEffortLevel()): string {
  const parts: string[] = [buildEffortDirective(level)];

  if (level === "low") {
    parts.push(
      "[OUTPUT EFFORT — turn note] Deliverable minimalism applies to the final user-visible " +
        "answer and artifacts; obey [REASONING BUDGET] for think()/reason() depth."
    );
  } else if (level === "high" || level === "xhigh") {
    parts.push(
      "[OUTPUT EFFORT — turn overrides] For this turn, deliverable thoroughness (R-EFFORT) " +
        "takes precedence over default brevity: do not apply R-EXECUTIVE-READ's ≤80% length target " +
        "unless the user asked for short/tldr/summary-only. Tool-first limits in [REASONING BUDGET] " +
        "still apply to think() and reason(); the final user-visible answer may be as complete as " +
        "the active output-effort level requires."
    );
  }

  return parts.join("\n\n");
}
