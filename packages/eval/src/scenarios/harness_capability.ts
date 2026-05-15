/**
 * Capability canaries for harness uplift (Tier 1/2) — no mocks, real tools.
 */
import type { Scenario } from "../runner.js";
import {
  traceToolRanOk,
  traceHasOrderedTools,
  traceCollectTextBlob,
  traceHasTool,
} from "../runner.js";

export const harnessMemoryQueryModes: Scenario = {
  name: "harness-memory-query-modes",
  userMessage:
    "Call memory_query with JSON args exactly: {\"mode\":\"exact\"} (no key) to list keys. " +
    "Then reply one line: OK",
  tags: ["smoke"],
  assertions: [
    {
      name: "memory_query ran ok",
      check: (t) => traceToolRanOk(t, "memory_query"),
    },
  ],
};

export const harnessAstGrepOrSkip: Scenario = {
  name: "harness-ast-grep-find-symbol",
  userMessage:
    "Call ast_grep with pattern `function` and path `packages/core/src` (or `.` if needed). " +
    "If the tool errors about ast-grep missing, reply: SKIP. Otherwise reply: OK",
  tags: ["retrieval"],
  assertions: [
    {
      name: "ast_grep invoked",
      check: (t) => traceHasTool(t, "ast_grep"),
    },
    {
      name: "ok or skip in blob",
      check: (t) => {
        const b = traceCollectTextBlob(t).toUpperCase();
        return b.includes("OK") || b.includes("SKIP");
      },
    },
  ],
};

export const harnessSymbolIndex: Scenario = {
  name: "harness-symbol-index",
  userMessage:
    "Call symbol_index with cwd set to the repo root `.` (or packages/core if needed). " +
    "Summarize one symbol name you saw. Reply OK.",
  tags: ["smoke"],
  assertions: [{ name: "symbol_index ok", check: (t) => traceToolRanOk(t, "symbol_index") }],
};

export const harnessRunLintTsc: Scenario = {
  name: "harness-run-lint-parse",
  userMessage:
    "Call run_lint with cwd `.` and mode tsc and project `packages/core/tsconfig.json`. " +
    "One sentence on whether tsc reported errors. Reply OK.",
  tags: ["slow"],
  assertions: [{ name: "run_lint invoked", check: (t) => traceHasTool(t, "run_lint") }],
};

export const harnessFindReferences: Scenario = {
  name: "harness-find-references",
  userMessage:
    "Call find_references with symbol `AgentHarness` and root `packages/core/src`. Reply OK.",
  tags: ["smoke"],
  assertions: [{ name: "find_references ok", check: (t) => traceToolRanOk(t, "find_references") }],
};

export const harnessPlanBeforeMultiStep: Scenario = {
  name: "harness-plan-rule-recall",
  userMessage:
    "The user requires exactly this sequence: (1) think() (2) plan() with at least 3 steps " +
    "describing how you would list packages/ (3) list_dir on packages/ once. " +
    "Then reply: OK",
  maxRounds: 14,
  tags: ["retrieval"],
  assertions: [
    { name: "think before plan", check: (t) => traceHasOrderedTools(t, "think", "plan") },
    { name: "plan before list_dir", check: (t) => traceHasOrderedTools(t, "plan", "list_dir") },
  ],
};

export const harnessDistillHandoff: Scenario = {
  name: "harness-distill-handoff",
  userMessage:
    "Use read_file on `packages/core/package.json`. If output mentions NEXT_ACTIONS_JSON, call read_artifact with that hash. Otherwise reply: NO_DISTILL",
  env: { AGENT_DISTILL: "1" },
  maxRounds: 12,
  tags: ["slow"],
  assertions: [
    {
      name: "read_file ok",
      check: (t) => traceToolRanOk(t, "read_file"),
    },
    {
      name: "artifact or no-distill",
      check: (t) => {
        const b = traceCollectTextBlob(t);
        return b.includes("NO_DISTILL") || b.includes("read_artifact") || b.includes("ERROR");
      },
    },
  ],
};

export const harnessSpawnContractTelemetry: Scenario = {
  name: "harness-spawn-contract-telemetry",
  userMessage:
    "Spawn one sub-agent with only goal, no system_prompt/user_prompt/spawn_contract. " +
    "Then wait_for_agents for that task id and reply OK.",
  tags: ["smoke"],
  assertions: [
    { name: "spawn_agent invoked", check: (t) => traceHasTool(t, "spawn_agent") },
    {
      name: "contract synthesized event emitted",
      check: (t) =>
        t.some(
          (e) =>
            e.type === "spawn_contract_created" &&
            (e.payload as { source?: string }).source === "synthesized"
        ),
    },
    {
      name: "handoff event emitted",
      check: (t) => t.some((e) => e.type === "subtask_handoff_written"),
    },
  ],
};

export const HARNESS_CAPABILITY_SCENARIOS: Scenario[] = [
  harnessMemoryQueryModes,
  harnessAstGrepOrSkip,
  harnessSymbolIndex,
  harnessRunLintTsc,
  harnessFindReferences,
  harnessPlanBeforeMultiStep,
  harnessDistillHandoff,
  harnessSpawnContractTelemetry,
];
