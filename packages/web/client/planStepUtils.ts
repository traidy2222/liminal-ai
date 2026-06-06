/** Browser-safe plan step helpers (mirror packages/core/src/plan_transcript.ts). */

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
