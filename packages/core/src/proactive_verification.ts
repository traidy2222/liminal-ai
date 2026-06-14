/**
 * In-flow verification — run checks immediately after edit/browser tool batches
 * so the model sees results before it can claim done (no turn-end gate / re-reply loop).
 */

import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const VERIFY_TOOL_NAMES = new Set([
  "run_lint",
  "run_tests",
  "verify_result",
  "verify_contract",
]);

export const BROWSER_VERIFY_TOOL_NAMES = new Set([
  "browser_open",
  "browser_act",
  "browser_snapshot",
  "browser_navigate",
]);

const TYPED_CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|vue|svelte)$/i;

const SHELL_VERIFY_RE =
  /\b(npm run (test|typecheck|lint|build|check)|npx tsc|pnpm (test|lint|typecheck|build)|yarn (test|lint|build)|pytest|cargo test|go test|dotnet test|mvn test|gradle test|vitest|jest)\b/i;

/** Master switch — proactive in-flow checks (default on). */
export function proactiveVerificationEnabled(): boolean {
  const proactive = effectiveHarnessEnvRaw("AGENT_PROACTIVE_VERIFY");
  if (proactive === "0") return false;
  if (proactive === "1") return true;
  // Legacy turn-end gate key — treat enabled as proactive when new key unset.
  return effectiveHarnessEnvRaw("AGENT_VERIFY_BEFORE_DONE") !== "0";
}

/** Auto run_lint after typed file edits in a batch (default on). */
export function proactiveLintAfterEditsEnabled(): boolean {
  const raw = effectiveHarnessEnvRaw("AGENT_PROACTIVE_VERIFY_LINT");
  if (raw === "0") return false;
  if (raw === "1") return true;
  return effectiveHarnessEnvRaw("AGENT_VERIFY_BEFORE_DONE_AUTO_LINT") !== "0";
}

export function toolCallCountsAsVerification(toolName: string, argsJson?: string): boolean {
  if (VERIFY_TOOL_NAMES.has(toolName)) return true;
  if (toolName !== "run_shell" && toolName !== "run_command_with_pty") return false;
  try {
    const a = JSON.parse(argsJson ?? "{}") as { command?: string };
    const cmd = typeof a.command === "string" ? a.command : "";
    return SHELL_VERIFY_RE.test(cmd);
  } catch {
    return false;
  }
}

export function classifyChangedFiles(paths: string[]): {
  typedCode: string[];
  webAssets: string[];
  other: string[];
} {
  const typedCode: string[] = [];
  const webAssets: string[] = [];
  const other: string[] = [];
  for (const p of paths) {
    const norm = p.replace(/\\/g, "/");
    if (TYPED_CODE_EXT.test(norm)) typedCode.push(norm);
    else if (/\.(html|htm|css)$/i.test(norm)) webAssets.push(norm);
    else other.push(norm);
  }
  return { typedCode, webAssets, other };
}

export function buildProactiveLintPassMessage(scope: string[], lintBody: string): string {
  const preview = lintBody.slice(0, 5500);
  return (
    "[VERIFY RESULT] run_lint passed — 0 error-severity diagnostics on files you just edited.\n" +
    `Scope: ${scope.join(", ")}\n` +
    (preview.length > 80 ? `Summary: ${preview.slice(0, 400)}…` : "")
  );
}

export function buildProactiveLintFailMessage(scope: string[], lintBody: string): string {
  const preview = lintBody.slice(0, 5500);
  return (
    "[VERIFY RESULT] run_lint found errors after your edits — fix before telling the user the work is done.\n" +
    "Use minimal edit_file changes, then continue (lint will re-run on the next edit batch).\n" +
    `Scope: ${scope.join(", ")}\n` +
    preview
  );
}

export function buildProactiveBrowserDiagnosticMessage(diagnostics: string): string {
  return (
    "[VERIFY RESULT] Browser session reports console/page errors after your last browser tool call. " +
    "Fix the issue, then browser_snapshot or browser_act(include_console:true) to confirm clean before claiming the UI works.\n\n" +
    diagnostics.slice(0, 6000)
  );
}

export function buildProactiveWebAssetHintMessage(paths: string[]): string {
  const preview = paths.slice(0, 6).join(", ");
  return (
    "[VERIFY HINT] You changed web assets (" +
    preview +
    (paths.length > 6 ? "…" : "") +
    "). Before claiming the UI works: browser_serve_file (if local) → browser_open with include_console:true, or run the project test command."
  );
}

/** Shown when tools ran but the model stopped without a user-visible answer — continues the ReAct loop. */
export const CONTINUE_AFTER_TOOLS_MESSAGE =
  "[SYSTEM NOTE] Tool work is in progress or just finished, but you have not written a user-visible answer yet. " +
  "Read any [VERIFY RESULT] lines above, fix remaining issues with tools if needed, then write your reply to the user. " +
  "Do not end the turn with only tool calls or a one-line stub.";
