import type { MessageEntry } from "./useSSE.js";
import { markPlanStepDone } from "./planStepUtils.js";

export {
  countPlanStepsDone,
  isPlanStepDone,
  markPlanStepDone,
  planStepLabel,
} from "./planStepUtils.js";

type PlanEntry = Extract<MessageEntry, { kind: "plan" }>;

function isEmptyPlan(m: MessageEntry): boolean {
  return m.kind === "plan" && m.steps.length === 0 && !m.previewText?.trim();
}

/** Drop streaming placeholders and empty plan shells from step_index-only calls. */
export function stripEphemeralPlanEntries(
  messages: MessageEntry[],
  callId?: string
): MessageEntry[] {
  return messages.filter((m) => {
    if (m.kind !== "plan") return true;
    if (isEmptyPlan(m)) return false;
    if (m.streaming && callId && m.callId === callId) return false;
    if (m.streaming && m.steps.length === 0 && !m.previewText?.trim()) return false;
    return true;
  });
}

/** Create or replace the single active plan card (replan replaces the last plan). */
export function upsertPlanSteps(
  messages: MessageEntry[],
  steps: string[],
  callId?: string
): MessageEntry[] {
  const cleaned = stripEphemeralPlanEntries(messages, callId);
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const m = cleaned[i]!;
    if (m.kind === "plan") {
      const next: PlanEntry = { ...m, steps, streaming: false, callId };
      return [...cleaned.slice(0, i), next, ...cleaned.slice(i + 1)];
    }
  }
  return [...cleaned, { kind: "plan", steps, streaming: false, callId }];
}

/** Mark one step complete on the latest plan; never spawn a new plan card. */
export function applyPlanStepDone(
  messages: MessageEntry[],
  stepIndex: number,
  callId?: string
): MessageEntry[] {
  const cleaned = stripEphemeralPlanEntries(messages, callId);
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const m = cleaned[i]!;
    if (m.kind === "plan" && m.steps.length > 0) {
      const next: PlanEntry = {
        ...m,
        steps: markPlanStepDone(m.steps, stepIndex),
        streaming: false,
      };
      return [...cleaned.slice(0, i), next, ...cleaned.slice(i + 1)];
    }
  }
  return cleaned;
}
