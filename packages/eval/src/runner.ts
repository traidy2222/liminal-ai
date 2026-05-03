/**
 * Eval runner — runs behavioral scenario assertions against a live AgentHarness.
 * (#10 Eval Infrastructure — ReliabilityBench arXiv:2601.06112)
 *
 * Scenarios use the real LLM (via OpenRouter) as integration tests.
 * Set EVAL_MODEL env var to override the model (default: openai/gpt-4o-mini).
 * Set OPENROUTER_API_KEY env var to authenticate.
 */
import {
  AgentHarness,
  type AgentConfig,
  type ToolResult,
  type ToolHandler,
  type AgentEventMap,
} from "@liminal/core";
import { registerAllTools, INCEPTION_MESSAGES } from "@liminal/tools";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TraceEvent {
  type: string;
  /** Raw event payload from AgentEmitter. */
  payload: unknown;
  at: number;
}

/**
 * Mock a specific tool's handler for the duration of a scenario.
 * `original` is the real handler — call it for pass-through behaviour.
 */
export interface MockHandler {
  toolName: string;
  handler: (
    args: Record<string, unknown>,
    original: ToolHandler
  ) => Promise<ToolResult>;
}

export interface ScenarioAssertion {
  name: string;
  check: (trace: TraceEvent[]) => boolean;
}

export interface Scenario {
  name: string;
  userMessage: string;
  mocks?: MockHandler[];
  assertions: ScenarioAssertion[];
  /** Hard timeout for harness.send(). Default: 60_000 ms. */
  timeoutMs?: number;
  /** Max ReAct rounds. Default: 20. */
  maxRounds?: number;
}

export interface ScenarioResult {
  scenario: string;
  passed: boolean;
  assertions: Array<{ name: string; passed: boolean }>;
  durationMs: number;
  /** Populated if harness.send() threw or timed out. */
  error?: string;
}

// ─── Trace helpers ────────────────────────────────────────────────────────────

/** True if the trace contains a tool_result event for the given tool name. */
export function traceHasTool(trace: TraceEvent[], toolName: string): boolean {
  return trace.some(
    (e) =>
      e.type === "tool_result" &&
      (e.payload as AgentEventMap["tool_result"]).name === toolName
  );
}

/** True if toolA's first tool_result appears before toolB's first tool_result. */
export function traceHasOrderedTools(
  trace: TraceEvent[],
  toolA: string,
  toolB: string
): boolean {
  const results = trace.filter((e) => e.type === "tool_result");
  const idxA = results.findIndex(
    (e) => (e.payload as AgentEventMap["tool_result"]).name === toolA
  );
  const idxB = results.findIndex(
    (e) => (e.payload as AgentEventMap["tool_result"]).name === toolB
  );
  return idxA !== -1 && idxB !== -1 && idxA < idxB;
}

/** True if a turn_end event is in the trace. */
export function traceHasTurnEnd(trace: TraceEvent[]): boolean {
  return trace.some((e) => e.type === "turn_end");
}

/** Returns the contextSnapshot from the turn_end event, or null. */
export function traceGetSnapshot(
  trace: TraceEvent[]
): AgentEventMap["turn_end"]["contextSnapshot"] | null {
  const ev = trace.find((e) => e.type === "turn_end");
  if (!ev) return null;
  return (ev.payload as AgentEventMap["turn_end"]).contextSnapshot;
}

/**
 * Returns all tool_result payloads for the given tool name, in order.
 * Includes both successful and failed calls.
 */
export function traceToolResults(
  trace: TraceEvent[],
  toolName: string
): AgentEventMap["tool_result"][] {
  return trace
    .filter(
      (e) =>
        e.type === "tool_result" &&
        (e.payload as AgentEventMap["tool_result"]).name === toolName
    )
    .map((e) => e.payload as AgentEventMap["tool_result"]);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const EVAL_MODEL = process.env["EVAL_MODEL"] ?? "openai/gpt-4o-mini";

/** Build a minimal AgentConfig suitable for eval runs. */
function makeEvalConfig(
  maxRounds: number,
  timeoutMs: number
): AgentConfig {
  return {
    openRouterApiKey: process.env["OPENROUTER_API_KEY"] ?? "",
    model: EVAL_MODEL,
    baseURL: "https://openrouter.ai/api/v1",
    maxToolRoundsPerTurn: maxRounds,
    sendTimeoutMs: timeoutMs,
    context: {
      modelMaxTokens: 32_000,
      thresholdFraction: 0.8,
      inceptionMessages: INCEPTION_MESSAGES,
    },
  };
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const t0 = Date.now();
  const trace: TraceEvent[] = [];

  const harness = new AgentHarness(
    makeEvalConfig(scenario.maxRounds ?? 20, scenario.timeoutMs ?? 60_000)
  );
  registerAllTools(harness.registry, harness.emitter, harness);

  // Inject mock handlers via registry.replace()
  for (const mock of scenario.mocks ?? []) {
    const existing = harness.registry.get(mock.toolName);
    if (!existing) continue;
    const originalHandler = existing.handler;
    const mockFn = mock.handler;
    harness.registry.replace({
      ...existing,
      requiresApproval: false, // skip approval gate in eval
      handler: (args) => mockFn(args, originalHandler),
    });
  }

  // Capture all named events into the trace
  const capturedEvents = [
    "text",
    "tool_start",
    "tool_delta",
    "tool_result",
    "turn_end",
    "error",
    "context_compressed",
    "tool_timing",
    "subtask_spawned",
    "subtask_complete",
  ] as const satisfies ReadonlyArray<keyof AgentEventMap>;

  for (const evName of capturedEvents) {
    harness.emitter.on(evName, (payload) => {
      trace.push({ type: evName, payload, at: Date.now() });
    });
  }

  // Auto-approve all tool approval gates (eval never blocks on human input)
  harness.emitter.on("tool_approval", (payload) => {
    payload.resolve({ decision: "approve" });
  });

  // Auto-answer any ask_user prompts
  harness.emitter.on("ask_user", (payload) => {
    payload.resolve("(eval auto-answer: N/A)");
  });

  let runError: string | undefined;
  try {
    await harness.send(scenario.userMessage);
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    trace.push({ type: "error", payload: { err: { message: runError } }, at: Date.now() });
  }

  const assertionResults = scenario.assertions.map((a) => ({
    name: a.name,
    passed: (() => {
      try {
        return a.check(trace);
      } catch {
        return false;
      }
    })(),
  }));

  const passed = assertionResults.every((a) => a.passed);

  return {
    scenario: scenario.name,
    passed,
    assertions: assertionResults,
    durationMs: Date.now() - t0,
    error: runError,
  };
}
