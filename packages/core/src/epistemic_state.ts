/**
 * Structured working / epistemic state (COMPASS-style bounded task snapshot).
 * Rendered into [WORKING STATE] each buildMessages; updated by AgentHarness each tool round.
 */
import type { EpistemicState } from "./types.js";

export function emptyEpistemicState(goal: string): EpistemicState {
  return {
    goal: goal.slice(0, 2000),
    subgoals: [],
    hypotheses: [],
    filesTouched: [],
    openQuestions: [],
    budget: { usagePct: 0, recallK: 8, spareRounds: 16 },
  };
}

export function mergeEpistemicState(
  base: EpistemicState,
  patch: Partial<EpistemicState>
): EpistemicState {
  const out: EpistemicState = {
    goal: patch.goal ?? base.goal,
    subgoals: patch.subgoals !== undefined ? [...patch.subgoals] : [...base.subgoals],
    hypotheses: patch.hypotheses !== undefined ? [...patch.hypotheses] : [...base.hypotheses],
    filesTouched:
      patch.filesTouched !== undefined
        ? [...new Set([...base.filesTouched, ...patch.filesTouched])]
        : [...base.filesTouched],
    lastVerified: patch.lastVerified ?? base.lastVerified,
    openQuestions:
      patch.openQuestions !== undefined ? [...patch.openQuestions] : [...base.openQuestions],
    budget: patch.budget !== undefined ? { ...base.budget, ...patch.budget } : { ...base.budget },
    harnessNotes: patch.harnessNotes ?? base.harnessNotes,
  };
  return out;
}

/** Fixed-shape block for the model (token-bounded). */
export function renderEpistemicStateBlock(e: EpistemicState, maxChars = 3500): string {
  const lines: string[] = [];
  lines.push("## Goal");
  lines.push(e.goal.slice(0, 500) + (e.goal.length > 500 ? "…" : ""));
  lines.push("");
  lines.push("## Subgoals");
  if (e.subgoals.length === 0) lines.push("(none — infer from goal)");
  else {
    for (const s of e.subgoals.slice(0, 12)) {
      lines.push(`- [${s.status}] ${s.id}${s.note ? ` — ${s.note}` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Hypotheses");
  if (e.hypotheses.length === 0) lines.push("(none)");
  else {
    for (const h of e.hypotheses.slice(0, 8)) {
      const ev = h.evidence?.length ? ` evidence: ${h.evidence.slice(0, 2).join("; ")}` : "";
      lines.push(`- (${h.confidence}) ${h.claim.slice(0, 200)}${ev}`);
    }
  }
  lines.push("");
  lines.push("## Files touched (this send)");
  if (e.filesTouched.length === 0) lines.push("(none yet)");
  else lines.push(e.filesTouched.slice(-16).join(" | "));
  lines.push("");
  lines.push("## Last verified");
  if (e.lastVerified) {
    lines.push(`- what: ${e.lastVerified.what.slice(0, 200)}`);
    lines.push(`- how: ${e.lastVerified.how.slice(0, 200)}`);
  } else lines.push("(none yet)");
  lines.push("");
  lines.push("## Open questions");
  if (e.openQuestions.length === 0) lines.push("(none)");
  else lines.push(e.openQuestions.slice(0, 8).join(" | "));
  lines.push("");
  lines.push("## Context budget");
  lines.push(
    `usage≈${e.budget.usagePct}% · recall_k≤${e.budget.recallK} · spare_rounds≈${e.budget.spareRounds}`
  );
  if (e.harnessNotes?.trim()) {
    lines.push("");
    lines.push("## Harness");
    lines.push(e.harnessNotes.trim().slice(0, 800));
  }
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…[truncated]";
  return text;
}
