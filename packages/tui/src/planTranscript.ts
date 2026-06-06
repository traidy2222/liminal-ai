import { markPlanStepDone } from "@liminal/core";
import type { MessageEntry } from "./useAgent.js";

type PlanEntry = Extract<MessageEntry, { kind: "plan" }>;

function isEmptyPlan(m: MessageEntry): boolean {
  return m.kind === "plan" && m.steps.length === 0 && !m.previewText?.trim();
}

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
