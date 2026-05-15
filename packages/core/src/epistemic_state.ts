/**
 * Structured working / epistemic state (COMPASS-style bounded task snapshot).
 * Rendered into [WORKING STATE] each buildMessages; updated by AgentHarness each tool round.
 */
import type { EpistemicState } from "./types.js";

/** Map plan() steps[] into epistemic subgoals (harness-synced working state). */
export function subgoalsFromPlanSteps(steps: string[]): EpistemicState["subgoals"] {
  return steps.map((note, i) => ({
    id: `plan:${i}`,
    status: "todo" as const,
    note: note.slice(0, 500),
  }));
}

/** Mark one plan step done by 0-based index (matches plan tool step_index). */
export function markEpistemicPlanStepDone(
  subgoals: EpistemicState["subgoals"],
  stepIndex: number
): EpistemicState["subgoals"] {
  if (stepIndex < 0 || stepIndex >= subgoals.length) return subgoals;
  return subgoals.map((s, i) =>
    i === stepIndex ? { ...s, status: "done" as const } : s
  );
}

/**
 * If extract_structured returned JSON with a `subgoals` array, normalize into epistemic rows.
 */
export function mergeExtractedSubgoals(
  _existing: EpistemicState["subgoals"],
  extracted: unknown
): EpistemicState["subgoals"] | null {
  if (!Array.isArray(extracted)) return null;
  const next: EpistemicState["subgoals"] = [];
  for (const item of extracted) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? o["id"].slice(0, 64) : `ext:${next.length}`;
    const st = o["status"];
    const status =
      st === "done" || st === "todo" || st === "doing" || st === "blocked" ? st : "todo";
    const note = typeof o["note"] === "string" ? o["note"].slice(0, 500) : undefined;
    next.push({ id, status, note });
  }
  return next.length > 0 ? next : null;
}

export function emptyEpistemicState(goal: string): EpistemicState {
  return {
    goal: goal.slice(0, 2000),
    subgoals: [],
    hypotheses: [],
    filesTouched: [],
    filesModified: [],
    openQuestions: [],
    budget: { usagePct: 0, recallK: 8, spareRounds: 16 },
  };
}

export type EpistemicHypothesisRow = EpistemicState["hypotheses"][number];

/**
 * Append one hypothesis row, optionally marking an existing id as superseded.
 * Caps list length (FIFO drop oldest) to keep working state bounded.
 */
export function appendEpistemicHypothesis(
  current: EpistemicState["hypotheses"],
  entry: EpistemicHypothesisRow,
  opts?: { max?: number; supersede_id?: string }
): EpistemicState["hypotheses"] {
  const max = opts?.max ?? 12;
  const sid = opts?.supersede_id?.trim();
  let next = current.map((h) => ({ ...h }));
  if (sid) {
    next = next.map((h) =>
      h.id === sid
        ? {
            ...h,
            status: "superseded" as const,
            superseded_by: entry.id,
          }
        : h
    );
  }
  next.push(entry);
  if (next.length > max) next = next.slice(-max);
  return next;
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
    filesModified:
      patch.filesModified !== undefined
        ? [...new Set([...base.filesModified, ...patch.filesModified])]
        : [...base.filesModified],
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
      const id = h.id ? `[${h.id}] ` : "";
      const st = h.status && h.status !== "active" ? ` ${h.status}` : "";
      const ev = h.evidence?.length ? ` · evidence: ${h.evidence.slice(0, 2).join("; ")}` : "";
      const fal =
        h.falsifiers?.length ? ` · falsify-if: ${h.falsifiers.slice(0, 2).join(" | ")}` : "";
      const nt = h.next_test ? ` · next: ${h.next_test.slice(0, 120)}` : "";
      lines.push(`- ${id}(${h.confidence})${st} ${h.claim.slice(0, 180)}${ev}${fal}${nt}`);
    }
  }
  lines.push("");
  lines.push("## Files read (this send)");
  if (e.filesTouched.length === 0) lines.push("(none yet)");
  else lines.push(e.filesTouched.slice(-16).join(" | "));
  lines.push("");
  lines.push("## Files modified (this send)");
  if (e.filesModified.length === 0) lines.push("(none yet)");
  else lines.push(e.filesModified.slice(-16).join(" | "));
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
