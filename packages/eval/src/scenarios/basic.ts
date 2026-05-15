/**
 * 5 baseline behavioral scenarios for regression detection.
 * (#10 Eval Infrastructure — ReliabilityBench arXiv:2601.06112)
 *
 * These are integration tests — they use the real LLM. All 5 should pass on
 * any capable model that follows the system prompt.
 */
import type { Scenario } from "../runner.js";
import {
  traceHasTool,
  traceHasTurnEnd,
  traceGetSnapshot,
  traceToolResults,
  traceTerminatedCleanly,
  traceGetHarnessMetrics,
} from "../runner.js";

// ─── Scenario 1: Basic smoke test ─────────────────────────────────────────────

/**
 * Verifies the harness runs a turn end-to-end and emits a valid contextSnapshot.
 * The most fundamental test — if this fails, nothing else will pass.
 */
export const turnEndFires: Scenario = {
  name: "turn-end-fires",
  userMessage: "Say hello in one word.",
  maxRounds: 5,
  timeoutMs: 30_000,
  assertions: [
    {
      name: "turn_end event fires",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "contextSnapshot has valid usageFraction in [0, 1]",
      check: (trace) => {
        const snap = traceGetSnapshot(trace);
        return (
          snap !== null &&
          typeof snap.usageFraction === "number" &&
          snap.usageFraction >= 0 &&
          snap.usageFraction <= 1
        );
      },
    },
    {
      name: "contextSnapshot has tokenCount > 0",
      check: (trace) => {
        const snap = traceGetSnapshot(trace);
        return snap !== null && snap.tokenCount > 0;
      },
    },
  ],
};

// ─── Scenario 2: Reflexion fires after all-tool failure ───────────────────────

/**
 * Verifies the harness auto-persists a reflection after a round where all
 * tools fail (Reflexion — arXiv:2303.11366). Uses a mock that intercepts
 * remember() calls to detect directCall-based writes.
 *
 * Implementation: all tools that the agent will try to call are mocked to
 * return failure. The harness auto-calls remember() via directCall; we detect
 * it by replacing the remember handler with one that sets a flag in the trace.
 */
export const reflexionOnAllFailure: Scenario = {
  name: "reflexion-on-all-failure",
  userMessage:
    "Use read_file to read the file at path '/nonexistent/path/test.txt' and report what you find.",
  maxRounds: 8,
  timeoutMs: 45_000,
  mocks: [
    {
      // Mock read_file to always fail so the harness triggers reflexion
      toolName: "read_file",
      handler: async (_args, _original) => ({
        ok: false,
        error: "ENOENT: no such file or directory '/nonexistent/path/test.txt'",
      }),
    },
    {
      // Intercept remember() to push a custom trace event — catches directCall too
      toolName: "remember",
      handler: async (args, original) => {
        // We detect reflexion keys (pattern: "reflection:*")
        const key = args["key"] as string | undefined;
        if (typeof key === "string" && key.startsWith("reflection:")) {
          // Push a synthetic trace event to make this detectable in assertions
          // (directCall bypasses the emitter, so we inject it here)
          (globalThis as Record<string, unknown>).__evalReflexionFired = true;
        }
        return original(args);
      },
    },
  ],
  assertions: [
    {
      name: "turn completes without harness crash",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "reflexion remember() was called after failure",
      // Reflexion uses directCall so it won't appear in trace events.
      // We detect it via the globalThis flag set by the mock handler.
      check: (_trace) => {
        const fired = (globalThis as Record<string, unknown>).__evalReflexionFired === true;
        // Clean up after assertion
        delete (globalThis as Record<string, unknown>).__evalReflexionFired;
        return fired;
      },
    },
  ],
};

// ─── Scenario 3: Recipe recording after successful multi-tool turn ─────────────

/**
 * Verifies the harness auto-records a recipe memory after a turn with ≥ 4
 * successful tool calls (Episodic Recipe Recording — arXiv:2602.22769).
 *
 * Prompt triggers think + plan + read_file (mocked) + list_dir (mocked).
 * Intercept remember() to detect recipe writes.
 */
export const recipeRecording: Scenario = {
  name: "recipe-recording",
  userMessage:
    "I need you to: 1) think about what files might be in /tmp, 2) list the /tmp directory, " +
    "3) read /tmp/readme.txt, 4) plan out these steps before doing them, then report what you found.",
  maxRounds: 15,
  timeoutMs: 60_000,
  mocks: [
    {
      toolName: "list_dir",
      handler: async (_args, _original) => ({
        ok: true,
        output: "readme.txt  notes.txt  data.csv",
      }),
    },
    {
      toolName: "read_file",
      handler: async (_args, _original) => ({
        ok: true,
        output: "This is the readme content.",
      }),
    },
    {
      toolName: "remember",
      handler: async (args, original) => {
        const key = args["key"] as string | undefined;
        if (typeof key === "string" && key.startsWith("recipe:")) {
          (globalThis as Record<string, unknown>).__evalRecipeFired = true;
        }
        return original(args);
      },
    },
  ],
  assertions: [
    {
      name: "turn_end fires (multi-tool run completed)",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "at least one tool_result in trace",
      check: (trace) =>
        trace.some((e) => e.type === "tool_result"),
    },
    {
      name: "recipe remember() was called after ≥4 successful tool calls",
      check: (_trace) => {
        const fired = (globalThis as Record<string, unknown>).__evalRecipeFired === true;
        delete (globalThis as Record<string, unknown>).__evalRecipeFired;
        return fired;
      },
    },
  ],
};

// ─── Scenario 4: run_shell is not blocked by think/plan preflight ───────────────

/**
 * The dispatcher no longer requires think() or plan() before run_shell.
 * This scenario uses a mocked run_shell and asserts we never emit the old
 * "Destructive tool … blocked" preflight error (regression guard).
 */
export const runShellNoThinkPreflight: Scenario = {
  name: "run-shell-no-think-preflight",
  userMessage: "Run the shell command `echo hello` and show me the output.",
  maxRounds: 15,
  timeoutMs: 45_000,
  mocks: [
    {
      toolName: "run_shell",
      handler: async (_args, _original) => ({
        ok: true,
        output: "hello",
      }),
    },
  ],
  assertions: [
    {
      name: "turn_end fires",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "run_shell was never blocked by think/plan preflight",
      check: (trace) => {
        const shellResults = traceToolResults(trace, "run_shell");
        return !shellResults.some(
          (r) =>
            !r.result.ok &&
            typeof r.result.error === "string" &&
            r.result.error.includes("Destructive tool") &&
            r.result.error.includes("blocked")
        );
      },
    },
  ],
};

// ─── Scenario 5: Plan emitted for multi-step task ─────────────────────────────

/**
 * Verifies the agent calls plan() for a task with 3+ explicit steps
 * (AgentProp-Bench structured tracking — arXiv:2604.16706).
 * System prompt instructs: "Before a task with 3+ steps, call plan()."
 */
export const planBeforeMultiStep: Scenario = {
  name: "plan-before-multi-step",
  userMessage:
    "I need you to do exactly 3 things in order: " +
    "1) Use think() to reflect on the number 42. " +
    "2) Use think() to reflect on the word 'hello'. " +
    "3) Respond with a brief summary of your thoughts. " +
    "Please plan these steps before executing them.",
  maxRounds: 20,
  timeoutMs: 60_000,
  tags: ["smoke"],
  assertions: [
    {
      name: "clean harness shutdown (ok or round_cap)",
      check: (trace) => {
        const m = traceGetHarnessMetrics(trace);
        const r = m?.terminationReason;
        const okReason = !r || r === "ok" || r === "round_cap";
        return traceTerminatedCleanly(trace) && okReason;
      },
    },
    {
      name: "plan() tool was called",
      check: (trace) => traceHasTool(trace, "plan"),
    },
    {
      name: "think() was called at least once",
      check: (trace) => traceHasTool(trace, "think"),
    },
  ],
};

// ─── Export all ───────────────────────────────────────────────────────────────

export const ALL_SCENARIOS = [
  turnEndFires,
  reflexionOnAllFailure,
  recipeRecording,
  runShellNoThinkPreflight,
  planBeforeMultiStep,
];
