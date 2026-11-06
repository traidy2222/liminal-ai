/**
 * Coding-turn system injection — autonomous implement/verify loop (not constant nudges).
 */

const BRIEF_CODING_RE =
  /\b(quick fix|one-liner|tiny change|just (a )?line|single character|typo)\b/i;

/** Opening injection for coding / implementation-classified turns. */
export function buildCodingTurnInjection(input: { userMessage: string }): string {
  const brief = BRIEF_CODING_RE.test(input.userMessage.trim());
  const scale = brief
    ? "Small ask — still follow locate → mutate → verify; skip drive-by refactors."
    : "Work autonomously until the task is done or blocked: locate → mutate → verify → next slice. Do not stop after a plan or a single file if the user asked for a feature/fix across the repo.";

  return (
    "[CODING TURN] Ship working code with tools — not a long reasoning essay or checklist you never execute.\n" +
    "**Loop:** (1) **Locate** — grep_file / read_file(offset+limit) / list_dir for paths you will touch. " +
    "(2) **Mutate** — edit_file replacements from known current content; write_file mode=create for new files only. " +
    "(3) **Verify** — after edits the harness auto-runs run_lint and injects [VERIFY RESULT]; read it before your summary. For UIs use browser_open (include_console:true). Run run_tests when needed.\n" +
    "**File currency:** Reuse known current content and successful edit results. Reread on an external change, version mismatch or replacement failure, not after every successful edit.\n" +
    "**Execution:** On Windows the shell is PowerShell (see protocol). One run_shell at a time; long builds need explicit timeout_ms.\n" +
    `${scale} When verification passes (or the user scope is met), reply in chat with paths changed and what you verified.`
  );
}
