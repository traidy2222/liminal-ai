/**
 * Sandbox capability lab — real harness tools in isolated temp workspaces.
 *
 * Each scenario copies a seeded fixture from packages/eval/fixtures/sandbox/
 * into a throwaway directory. Side effects never touch the monorepo or ~/.liminal.
 *
 * Run: npm run eval:sandbox
 */
import type { Scenario } from "../runner.js";
import {
  traceCollectTextBlob,
  traceHasTool,
  traceToolRanOk,
  traceToolResults,
} from "../runner.js";
import { readSandboxText, sandboxFileExists } from "../sandboxLabBootstrap.js";

export const sandboxReadEditVerify: Scenario = {
  name: "sandbox-read-edit-verify",
  sandboxFixture: "read-edit-verify",
  tags: ["sandbox", "smoke", "files"],
  userMessage:
    "In this workspace only: read `src/greeting.txt`, fix the typo so it says `Hello, world!`, " +
    "using edit_file (no shell). Reply FIXED when the file on disk is correct.",
  maxRounds: 10,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "read_file succeeded",
      check: (t) => traceToolRanOk(t, "read_file"),
    },
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "greeting.txt fixed on disk",
      check: (_t, ctx) => readSandboxText(ctx, "src/greeting.txt")?.trim() === "Hello, world!",
    },
  ],
};

export const sandboxRunLintFix: Scenario = {
  name: "sandbox-run-lint-fix",
  sandboxFixture: "broken-ts",
  tags: ["sandbox", "slow", "lint"],
  userMessage:
    "This workspace has a TypeScript error in `src/app.ts`. " +
    "1) Call run_lint with mode tsc and project `tsconfig.json`. " +
    "2) edit_file to fix the type error. " +
    "3) run_lint again until clean. Reply FIXED when tsc reports no errors.",
  maxRounds: 16,
  timeoutMs: 180_000,
  assertions: [
    {
      name: "run_lint invoked",
      check: (t) => traceHasTool(t, "run_lint"),
    },
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "type error removed from src/app.ts",
      check: (_t, ctx) => {
        const body = readSandboxText(ctx, "src/app.ts") ?? "";
        return !body.includes("const n: number = name");
      },
    },
    {
      name: "final lint output reports no errors",
      check: (t) => {
        const results = traceToolResults(t, "run_lint");
        if (results.length === 0) return false;
        const last = results[results.length - 1]!;
        const out = last.result.ok ? String(last.result.output ?? "").toLowerCase() : "";
        return (
          last.result.ok &&
          (out.includes("(tsc ok)") ||
            out.includes("0 error") ||
            out.includes("no errors") ||
            out.includes("found 0") ||
            !out.includes("error ts"))
        );
      },
    },
  ],
};

export const sandboxMiniRepoRead: Scenario = {
  name: "sandbox-mini-repo-read",
  sandboxFixture: "mini-repo",
  tags: ["sandbox", "smoke", "files"],
  userMessage:
    "Read `lib/math.js` in this workspace and reply one sentence describing what the `mul` function does.",
  maxRounds: 8,
  timeoutMs: 60_000,
  assertions: [
    {
      name: "read_file succeeded",
      check: (t) => traceToolRanOk(t, "read_file"),
    },
    {
      name: "answer mentions multiply/product/times",
      check: (t) => {
        const blob = traceCollectTextBlob(t).toLowerCase();
        return (
          blob.includes("multiply") ||
          blob.includes("product") ||
          blob.includes("times") ||
          blob.includes("multiplication") ||
          blob.includes("*")
        );
      },
    },
  ],
};

export const sandboxExecuteCode: Scenario = {
  name: "sandbox-execute-code",
  sandboxFixture: "mini-repo",
  tags: ["sandbox", "smoke", "code"],
  userMessage:
    "Activate the code_intel family if needed, then call execute_code with language javascript " +
    "and code exactly: console.log(42). Reply OK when the tool output contains 42.",
  maxRounds: 12,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "execute_code succeeded",
      check: (t) => traceToolRanOk(t, "execute_code"),
    },
    {
      name: "tool output contains 42",
      check: (t) => {
        const results = traceToolResults(t, "execute_code");
        return results.some(
          (r) => r.result.ok && String(r.result.output ?? "").includes("42")
        );
      },
    },
  ],
};

export const sandboxShellBoundary: Scenario = {
  name: "sandbox-shell-boundary",
  sandboxFixture: "mini-repo",
  tags: ["sandbox", "shell"],
  userMessage:
    "Call run_shell once with: node -e \"console.log(process.cwd())\" " +
    "(no other shell commands). Reply with the printed path.",
  maxRounds: 8,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "run_shell succeeded",
      check: (t) => traceToolRanOk(t, "run_shell"),
    },
    {
      name: "cwd output stays inside sandbox root",
      check: (t, ctx) => {
        if (!ctx?.sandboxRoot) return false;
        const normRoot = ctx.sandboxRoot.replace(/\\/g, "/").toLowerCase();
        const results = traceToolResults(t, "run_shell");
        const out = results
          .map((r) => (r.result.ok ? String(r.result.output ?? "") : ""))
          .join("\n");
        const normOut = out.replace(/\\/g, "/").toLowerCase();
        return normOut.includes(normRoot);
      },
    },
  ],
};

export const sandboxMemoryIsolated: Scenario = {
  name: "sandbox-memory-isolated",
  sandboxFixture: "memory-isolated",
  tags: ["sandbox", "memory"],
  userMessage:
    "Call remember with key `sandbox-lab-token` and value `SANDBOX_OK` (type note). " +
    "Then recall that key. Reply OK.",
  maxRounds: 10,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "remember succeeded",
      check: (t) => traceToolRanOk(t, "remember"),
    },
    {
      name: "recall succeeded",
      check: (t) => traceToolRanOk(t, "recall"),
    },
    {
      name: "note value persisted in isolated workspace notes",
      check: (_t, ctx) => {
        const notes = readSandboxText(ctx, ".agent_notes.json");
        return notes !== null && notes.includes("SANDBOX_OK");
      },
    },
    {
      name: "workspace-local notes.json created",
      check: (_t, ctx) => sandboxFileExists(ctx, ".agent_notes.json"),
    },
  ],
};

export const sandboxWriteTwoFiles: Scenario = {
  name: "sandbox-write-two-files",
  sandboxFixture: "memory-isolated",
  tags: ["sandbox", "files"],
  userMessage:
    "Use write_file only (no shell). Create `out/a.txt` with content `ALPHA\\n` and `out/b.txt` with `BETA\\n`. " +
    "Reply DONE when both files exist.",
  maxRounds: 10,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "write_file succeeded at least twice",
      check: (t) => traceToolResults(t, "write_file").filter((r) => r.result.ok).length >= 2,
    },
    {
      name: "out/a.txt on disk",
      check: (_t, ctx) => readSandboxText(ctx, "out/a.txt")?.includes("ALPHA") === true,
    },
    {
      name: "out/b.txt on disk",
      check: (_t, ctx) => readSandboxText(ctx, "out/b.txt")?.includes("BETA") === true,
    },
  ],
};

/**
 * Researcher-grade sandbox stress test — open-ended brief, disk oracles only.
 * Uses GLM-5 (no smoke tag). Isolated fixture; no live web.
 */
export const sandboxResearchAudit: Scenario = {
  name: "sandbox-research-audit",
  sandboxFixture: "research-lab",
  tags: ["sandbox", "slow", "research", "lint"],
  userMessage:
    "You're the researcher assigned to the rate-limiter batch audit in this workspace. " +
    "Read `brief.md` and complete the assignment.",
  maxRounds: 28,
  timeoutMs: 420_000,
  env: {
    /** Full harness sidecars — this scenario is meant to stress capability, not latency trims. */
    AGENT_INTENT_INFERENCE: "1",
    AGENT_WORLD_CONTEXT: "0",
    AGENT_RULE_RECALL: "0",
    AGENT_MEMORY_PRIME_ROUND0: "0",
  },
  assertions: [
    {
      name: "at least four distinct tools succeeded",
      check: (t) => {
        const names = new Set<string>();
        for (const e of t) {
          if (e.type !== "tool_result") continue;
          const p = e.payload as { name?: string; result?: { ok?: boolean } };
          if (p.name && p.result?.ok) names.add(p.name);
        }
        return names.size >= 4;
      },
    },
    {
      name: "read at least three files",
      check: (t) => traceToolResults(t, "read_file").filter((r) => r.result.ok).length >= 3,
    },
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "run_lint invoked",
      check: (t) => traceHasTool(t, "run_lint"),
    },
    {
      name: "BATCH_SIZE is 32 on disk",
      check: (_t, ctx) => {
        const body = readSandboxText(ctx, "src/rate_limiter.ts") ?? "";
        return /\bBATCH_SIZE\s*=\s*32\b/.test(body) && !/\bBATCH_SIZE\s*=\s*16\b/.test(body);
      },
    },
    {
      name: "report cites corpus and batch size",
      check: (_t, ctx) => {
        const report = readSandboxText(ctx, "report/findings.md") ?? "";
        const lower = report.toLowerCase();
        return (
          report.includes("32") &&
          (lower.includes("study_b") || lower.includes("corpus/study_b")) &&
          (lower.includes("study_a") || lower.includes("corpus/"))
        );
      },
    },
    {
      name: "final lint clean or tsc ok",
      check: (t) => {
        const results = traceToolResults(t, "run_lint");
        if (results.length === 0) return false;
        const last = results[results.length - 1]!;
        const out = last.result.ok ? String(last.result.output ?? "").toLowerCase() : "";
        return (
          last.result.ok &&
          (out.includes("(tsc ok)") ||
            out.includes("0 error") ||
            out.includes("no errors") ||
            !out.includes("error ts"))
        );
      },
    },
  ],
};

export const SANDBOX_CAPABILITY_LAB_SCENARIOS: Scenario[] = [
  sandboxReadEditVerify,
  sandboxRunLintFix,
  sandboxMiniRepoRead,
  sandboxExecuteCode,
  sandboxShellBoundary,
  sandboxMemoryIsolated,
  sandboxWriteTwoFiles,
  sandboxResearchAudit,
];
