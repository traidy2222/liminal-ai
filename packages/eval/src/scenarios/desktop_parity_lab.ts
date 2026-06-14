/**
 * Desktop-parity eval scenarios — same disk oracles as sandbox lab, but run through
 * liminald's SessionBridge + ChatRegistry-equivalent harness config.
 *
 * Prompts are written like real user messages (no tool recipes). Disk assertions
 * are the source of truth.
 */
import type { Scenario, ScenarioRunContext, TraceEvent } from "../runner.js";
import {
  traceCollectTextBlob,
  traceHasTool,
  traceToolRanOk,
  traceToolResults,
} from "../runner.js";
import { readSandboxText, sandboxFileExists, sandboxTscClean } from "../sandboxLabBootstrap.js";

function lastLintReportsClean(t: TraceEvent[]): boolean {
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
}

/** User got the workspace path — shell or grounded answer citing sandbox root. */
function workspacePathAnswered(t: TraceEvent[], ctx?: { sandboxRoot?: string }): boolean {
  if (traceToolRanOk(t, "run_shell")) {
    if (!ctx?.sandboxRoot) return true;
    const normRoot = ctx.sandboxRoot.replace(/\\/g, "/").toLowerCase();
    const results = traceToolResults(t, "run_shell");
    const out = results
      .map((r) => (r.result.ok ? String(r.result.output ?? "") : ""))
      .join("\n");
    return out.replace(/\\/g, "/").toLowerCase().includes(normRoot);
  }
  if (!ctx?.sandboxRoot) return false;
  const normRoot = ctx.sandboxRoot.replace(/\\/g, "/").toLowerCase();
  return traceCollectTextBlob(t).replace(/\\/g, "/").toLowerCase().includes(normRoot);
}

const RESEARCH_AUDIT_ASSERTIONS: Scenario["assertions"] = [
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
      name: "final lint clean or harness verify",
      check: (t, ctx) => sandboxTscClean(ctx) || lastLintReportsClean(t),
    },
];

/** Open-ended research brief — desktop stack (SessionBridge, latency mode, real approvals). */
export const desktopResearchAudit: Scenario = {
  name: "desktop-research-audit",
  parityProfile: "desktop",
  sandboxFixture: "research-lab",
  tags: ["desktop-parity", "slow", "research", "lint"],
  userMessage:
    "You're the researcher assigned to the rate-limiter batch audit in this workspace. " +
    "Read `brief.md` and complete the assignment.",
  maxRounds: 128,
  timeoutMs: 600_000,
  assertions: RESEARCH_AUDIT_ASSERTIONS,
};

/** Minimal file-edit check on desktop path — compares against sandbox-read-edit-verify. */
export const desktopReadEditVerify: Scenario = {
  name: "desktop-read-edit-verify",
  parityProfile: "desktop",
  sandboxFixture: "read-edit-verify",
  tags: ["desktop-parity", "smoke", "files"],
  userMessage:
    "In this workspace, fix the typo in `src/greeting.txt` so it says Hello, world! when you're done.",
  maxRounds: 128,
  timeoutMs: 180_000,
  assertions: [
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

/** TypeScript won't compile — everyday "fix my build" ask. */
export const desktopFixTsCompile: Scenario = {
  name: "desktop-fix-ts-compile",
  parityProfile: "desktop",
  sandboxFixture: "broken-ts",
  tags: ["desktop-parity", "smoke", "lint"],
  userMessage:
    "I'm trying to run this project but TypeScript errors out. Can you fix it so it compiles cleanly?",
  maxRounds: 128,
  timeoutMs: 240_000,
  assertions: [
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
      name: "tsc clean on disk",
      check: (_t, ctx) => sandboxTscClean(ctx),
    },
  ],
};

/** Skim a file and explain — no edits required. */
export const desktopExplainCode: Scenario = {
  name: "desktop-explain-code",
  parityProfile: "desktop",
  sandboxFixture: "mini-repo",
  tags: ["desktop-parity", "smoke", "read"],
  userMessage:
    "I'm new to this repo. In one sentence, what does the `mul` function in `lib/math.js` do?",
  maxRounds: 64,
  timeoutMs: 120_000,
  assertions: [
    {
      name: "read_file succeeded",
      check: (t) => traceToolRanOk(t, "read_file"),
    },
    {
      name: "answer mentions multiply or product",
      check: (t) => {
        const blob = traceCollectTextBlob(t).toLowerCase();
        return (
          blob.includes("multiply") ||
          blob.includes("product") ||
          blob.includes("times") ||
          blob.includes("multiplication")
        );
      },
    },
  ],
};

/** Fix a typo in meeting notes — common doc-edit task. */
export const desktopStandupTypo: Scenario = {
  name: "desktop-standup-typo",
  parityProfile: "desktop",
  sandboxFixture: "standup-notes",
  tags: ["desktop-parity", "smoke", "files"],
  userMessage:
    "In `notes/standup.md`, fix the typo in the recap line — it should say email, not emial.",
  maxRounds: 64,
  timeoutMs: 120_000,
  assertions: [
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "standup.md typo fixed on disk",
      check: (_t, ctx) => {
        const body = readSandboxText(ctx, "notes/standup.md") ?? "";
        return body.toLowerCase().includes("recap email") && !body.includes("emial");
      },
    },
  ],
};

/** Polish an email draft before sending. */
export const desktopEmailSubject: Scenario = {
  name: "desktop-email-subject",
  parityProfile: "desktop",
  sandboxFixture: "email-draft",
  tags: ["desktop-parity", "smoke", "files"],
  userMessage:
    "Before I send this, fix the typo in the Subject line of `draft.txt` (planning, not plannign). Save the file when done.",
  maxRounds: 64,
  timeoutMs: 120_000,
  assertions: [
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "subject line fixed on disk",
      check: (_t, ctx) => {
        const body = readSandboxText(ctx, "draft.txt") ?? "";
        return /planning/i.test(body) && !/plannign/i.test(body);
      },
    },
  ],
};

/** Patch bump for a hotfix release. */
export const desktopBumpVersion: Scenario = {
  name: "desktop-bump-version",
  parityProfile: "desktop",
  sandboxFixture: "package-bump",
  tags: ["desktop-parity", "smoke", "files"],
  userMessage:
    "We're cutting a bugfix release — bump the patch version in `package.json` from 1.2.3 to 1.2.4.",
  maxRounds: 64,
  timeoutMs: 120_000,
  assertions: [
    {
      name: "edit_file succeeded",
      check: (t) => traceToolRanOk(t, "edit_file"),
    },
    {
      name: "package.json version is 1.2.4",
      check: (_t, ctx) => readSandboxText(ctx, "package.json")?.includes('"version": "1.2.4"') === true,
    },
  ],
};

/** Remember a preference — how people actually use memory. */
export const desktopRememberPreference: Scenario = {
  name: "desktop-remember-preference",
  parityProfile: "desktop",
  sandboxFixture: "memory-isolated",
  tags: ["desktop-parity", "smoke", "memory"],
  userMessage:
    "Please remember that my standup time is 10am Pacific — I'll need that later in this project.",
  maxRounds: 64,
  timeoutMs: 120_000,
  assertions: [
    {
      name: "remember succeeded",
      check: (t) => traceToolRanOk(t, "remember"),
    },
    {
      name: "standup time persisted in workspace notes",
      check: (_t, ctx) => {
        const notes = readSandboxText(ctx, ".agent_notes.json") ?? "";
        const lower = notes.toLowerCase();
        return lower.includes("10") && lower.includes("pacific");
      },
    },
    {
      name: "workspace-local notes.json created",
      check: (_t, ctx) => sandboxFileExists(ctx, ".agent_notes.json"),
    },
  ],
};

/** Create handoff artifacts — two small output files. */
export const desktopWriteHandoff: Scenario = {
  name: "desktop-write-handoff",
  parityProfile: "desktop",
  sandboxFixture: "memory-isolated",
  tags: ["desktop-parity", "smoke", "files"],
  userMessage:
    "For the release handoff, create `out/a.txt` with `ALPHA` and `out/b.txt` with `BETA`.",
  maxRounds: 64,
  timeoutMs: 120_000,
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

/** Confirm shell cwd stays inside the workspace — real "where am I?" check. */
export const desktopShellCwd: Scenario = {
  name: "desktop-shell-cwd",
  parityProfile: "desktop",
  sandboxFixture: "mini-repo",
  tags: ["desktop-parity", "smoke", "shell"],
  userMessage:
    "What folder is this project in? I need the exact full path — run a command to print it, don't guess.",
  maxRounds: 64,
  timeoutMs: 180_000,
  assertions: [
    {
      name: "workspace path answered correctly",
      check: (t, ctx) => workspacePathAnswered(t, ctx),
    },
  ],
};

export const DESKTOP_PARITY_SCENARIOS: Scenario[] = [
  desktopReadEditVerify,
  desktopExplainCode,
  desktopStandupTypo,
  desktopEmailSubject,
  desktopBumpVersion,
  desktopRememberPreference,
  desktopWriteHandoff,
  desktopFixTsCompile,
  desktopShellCwd,
  desktopResearchAudit,
];

/** Quick desktop parity sweep — everything except slow/research. */
export const DESKTOP_PARITY_SMOKE_SCENARIOS = DESKTOP_PARITY_SCENARIOS.filter(
  (s) => !s.tags?.includes("slow")
);
