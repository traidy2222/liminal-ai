/**
 * Shared plan-step helpers for chat transcript reducers (web, TUI, desktop).
 * plan() uses a ✓ prefix on completed steps (0-based step_index from the tool).
 */

export function isPlanStepDone(step: string): boolean {
  return step.startsWith("✓");
}

export function planStepLabel(step: string): string {
  return isPlanStepDone(step) ? step.slice(2).trimStart() : step;
}

export function markPlanStepDone(steps: string[], stepIndex: number): string[] {
  if (stepIndex < 0 || stepIndex >= steps.length) return steps;
  return steps.map((s, j) =>
    j === stepIndex && !isPlanStepDone(s) ? `✓ ${s}` : s
  );
}

export function countPlanStepsDone(steps: string[]): number {
  return steps.filter(isPlanStepDone).length;
}
