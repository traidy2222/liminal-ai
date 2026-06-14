import "./evalWorkspaceBootstrap.js";
/**
 * Eval runner — runs behavioral scenario assertions against a live AgentHarness.
 * (#10 Eval Infrastructure — ReliabilityBench arXiv:2601.06112, AgentNoiseBench arXiv:2602.11348)
 *
 * Scenarios use the configured harness LLM (defaults: local OpenAI-compatible Qwen).
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentHarness,
  appendGoldenEvalRecord,
  buildAppSpecFromSpawn,
  loadRuntimePreferences,
  recordEvalScenarioOutcome,
  resolveWorkspaceRoot,
  type ProviderConfig,
  type AgentConfig,
  type LiminalAppManagerPort,
  type ToolResult,
  type ToolHandler,
  type AgentEventMap,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
} from "@liminal/tools";
import { prepareSandboxLab } from "./sandboxLabBootstrap.js";
import { runDesktopParitySend } from "./desktopParityRunner.js";
import {
  applyEvalModelEnv,
  evalFastModelSlug,
  mergeEvalManagedEnv,
  resolveEvalProvider,
} from "./evalProvider.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TraceEvent {
  type: string;
  /** Raw event payload from the AgentEmitter. */
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
  check: (trace: TraceEvent[], ctx?: ScenarioRunContext) => boolean;
}

/** Per-run context passed to scenario assertions (e.g. isolated sandbox root). */
export interface ScenarioRunContext {
  sandboxRoot?: string;
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
  /**
   * ReliabilityBench-style pass@k: repeat the same userMessage k times (fresh harness each run).
   * All k runs must satisfy assertions. Default 1.
   */
  passAtK?: number;
  /**
   * Semantic perturbations (ε): additional user messages treated as the same task.
   * Assertions must pass for every variant. Default: only userMessage.
   */
  paraphrases?: string[];
  /** Temporarily set process.env keys for this scenario run (restored after). */
  env?: Record<string, string>;
  /**
   * Tags for timeoutFor() when `timeoutMs` is unset: smoke, retrieval, web, slow, critic.
   */
  tags?: string[];
  /** When true, do not append to runs.jsonl (caller aggregates, e.g. CLI --repeat). */
  skipJsonSink?: boolean;
  /**
   * Approval / ask_user interaction mode for harness-interaction evals.
   * Default `auto_approve` (legacy). Use `reject_destructive` to exercise approval gates.
   */
  harnessInteraction?: "auto_approve" | "reject_destructive";
  /**
   * Copy `packages/eval/fixtures/sandbox/<id>/` into a temp workspace for this run.
   * Pins AGENT_WORKSPACE_ROOT + AGENT_GLOBAL_STORAGE_ROOT to the temp tree.
   */
  sandboxFixture?: string;
  /**
   * `sandbox` (default): lean eval harness + YOLO + SANDBOX_SPEED_ENV.
   * `desktop`: liminald-equivalent config + SessionBridge transport.
   */
  parityProfile?: "sandbox" | "desktop";
}

export interface ScenarioResult {
  scenario: string;
  passed: boolean;
  assertions: Array<{ name: string; passed: boolean }>;
  durationMs: number;
  /** Populated if harness.send() threw or timed out. */
  error?: string;
  /** One result per ε-variant when paraphrases were used. */
  variantErrors?: string[];
  /** Desktop-parity telemetry when parityProfile=desktop. */
  parityMeta?: import("./desktopParityRunner.js").DesktopParityRunMeta;
  /** From last `turn_end` harnessMetrics (when present). */
  terminationReason?: string | null;
  /** Count of successful tool_result events in the captured trace. */
  toolResultOkCount?: number;
  /** Distinct tool names with at least one tool_result. */
  distinctToolsInvoked?: string[];
  /** Recovery events observed in trace (replan/retry/escalate/ask_user). */
  recoveryActionCount?: number;
  /** Contract policy violations observed in trace. */
  contractViolationCount?: number;
  /** Number of drift detections emitted in trace. */
  driftDetections?: number;
  vaultActivities?: number;
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

/** Concatenate assistant-channel text deltas after the last user message (final reply). */
export function traceGetFinalAssistantText(trace: TraceEvent[]): string | null {
  let lastUserIdx = -1;
  for (let i = trace.length - 1; i >= 0; i--) {
    if (trace[i]?.type === "text") {
      const ch = (trace[i]!.payload as AgentEventMap["text"]).channel;
      if (ch === "user" || ch === undefined) {
        lastUserIdx = i;
        break;
      }
    }
  }
  const parts: string[] = [];
  for (let i = lastUserIdx + 1; i < trace.length; i++) {
    const e = trace[i];
    if (!e || e.type !== "text") continue;
    const p = e.payload as AgentEventMap["text"];
    if (p.channel && p.channel !== "assistant") continue;
    if (typeof p.delta === "string" && p.delta.length > 0) parts.push(p.delta);
  }
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : null;
}

/** harnessMetrics from last turn_end, if present. */
export function traceGetHarnessMetrics(
  trace: TraceEvent[]
): AgentEventMap["turn_end"]["harnessMetrics"] | null {
  const ev = trace.find((e) => e.type === "turn_end");
  if (!ev) return null;
  return (ev.payload as AgentEventMap["turn_end"]).harnessMetrics ?? null;
}

/** turn_end includes structured epistemicState.goal (harness uplift). */
export function traceHasEpistemicState(trace: TraceEvent[]): boolean {
  const m = traceGetHarnessMetrics(trace);
  return !!(m && m.epistemicState && typeof m.epistemicState.goal === "string");
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

/** Concatenate streamed assistant text + tool outputs for substring checks. */
export function traceCollectTextBlob(trace: TraceEvent[]): string {
  const parts: string[] = [];
  for (const e of trace) {
    if (e.type === "tool_result") {
      const p = e.payload as AgentEventMap["tool_result"];
      if (p.result.ok && typeof p.result.output === "string") parts.push(p.result.output);
      else if (!p.result.ok && typeof p.result.error === "string") parts.push(p.result.error);
    }
    if (e.type === "text") {
      const p = e.payload as AgentEventMap["text"];
      if (typeof p.delta === "string") parts.push(p.delta);
    }
  }
  return parts.join("\n");
}

/**
 * True if the harness recorded a normal turn end (always true after harness hardening
 * when send() completes, including round_cap / timeout / error paths).
 */
export function traceTerminatedCleanly(trace: TraceEvent[]): boolean {
  return traceHasTurnEnd(trace);
}

/** At least one successful tool_result for `toolName`. */
export function traceToolRanOk(trace: TraceEvent[], toolName: string): boolean {
  return traceToolResults(trace, toolName).some((r) => r.result.ok);
}

/** Any candidate substring appears in streamed text or tool outputs. */
export function traceMentionsAny(trace: TraceEvent[], candidates: string[]): boolean {
  const blob = traceCollectTextBlob(trace);
  return candidates.some((c) => c.length > 0 && blob.includes(c));
}

/**
 * Wall-clock timeout for harness.send() when `scenario.timeoutMs` is unset.
 * Tags: smoke 45s, retrieval 90s, web|slow 240s, critic 180s; default 60s.
 */
export function timeoutFor(scenario: Scenario): number {
  if (scenario.timeoutMs != null) return scenario.timeoutMs;
  const tags = new Set(scenario.tags ?? []);
  const tiers: number[] = [];
  if (tags.has("smoke")) tiers.push(45_000);
  if (tags.has("retrieval")) tiers.push(90_000);
  if (tags.has("web") || tags.has("slow")) tiers.push(240_000);
  if (tags.has("critic")) tiers.push(180_000);
  return tiers.length > 0 ? Math.max(...tiers) : 60_000;
}

function telemetryFromTraces(traces: TraceEvent[][]): Pick<
  ScenarioResult,
  | "terminationReason"
  | "toolResultOkCount"
  | "distinctToolsInvoked"
  | "recoveryActionCount"
  | "contractViolationCount"
  | "driftDetections"
  | "vaultActivities"
> {
  let terminationReason: string | null = null;
  const tools = new Set<string>();
  let toolResultOkCount = 0;
  let recoveryActionCount = 0;
  let contractViolationCount = 0;
  let driftDetections = 0;
  let vaultActivities = 0;
  for (const trace of traces) {
    for (const e of trace) {
      if (e.type === "turn_end") {
        const m = (e.payload as AgentEventMap["turn_end"]).harnessMetrics;
        if (m?.terminationReason) terminationReason = m.terminationReason;
      }
    }
    for (const e of trace) {
      if (e.type === "tool_result") {
        const p = e.payload as AgentEventMap["tool_result"];
        tools.add(p.name);
        if (p.result.ok) toolResultOkCount += 1;
      }
      if (e.type === "recovery_action") recoveryActionCount += 1;
      if (e.type === "contract_violation") contractViolationCount += 1;
      if (e.type === "drift_detected") driftDetections += 1;
      if (e.type === "vault_activity") vaultActivities += 1;
    }
  }
  return {
    terminationReason,
    toolResultOkCount,
    distinctToolsInvoked: [...tools].sort(),
    recoveryActionCount,
    contractViolationCount,
    driftDetections,
    vaultActivities,
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function createEvalMockAppManager(): LiminalAppManagerPort {
  return {
    isEnabled: () => true,
    listApps: async () => [],
    listAppsWithCaches: async () => ({ apps: [], caches: {} }),
    spawnApp: async (input) => {
      const built = buildAppSpecFromSpawn(input);
      if (!built.ok) throw new Error(built.error);
      return built.spec;
    },
    updateApp: async (appId, patch) => {
      const built = buildAppSpecFromSpawn({
        type: "weather",
        id: appId,
        props: (patch.props as Record<string, unknown>) ?? { location: "London" },
        title: patch.title,
      });
      if (!built.ok) throw new Error(built.error);
      return built.spec;
    },
    closeApp: async () => true,
    refreshApp: async () => ({ fetched_at: Date.now(), ok: true, data: {} }),
  };
}

const runtimePreferences = await loadRuntimePreferences();

/** Build a minimal AgentConfig suitable for eval runs. */
function makeEvalConfig(
  provider: ProviderConfig,
  maxRounds: number,
  _timeoutMs: number,
  workspaceRoot?: string,
  lean = false
): AgentConfig {
  return {
    openRouterApiKey: provider.apiKey,
    model: provider.model,
    baseURL: provider.baseURL,
    maxToolRoundsPerTurn: maxRounds,
    workingStateEnabled: !lean,
    runtimePreferences,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    context: {
      modelMaxTokens: 32_000,
      thresholdFraction: 0.8,
      inceptionMessages: INCEPTION_MESSAGES,
      protocolDynamicBuilder: (names, hint, registry) =>
        buildProtocolDynamicSuffix(names, (hint ?? "any") as import("@liminal/tools").ProtocolIntentHint, registry),
      compressionGuideline:
        "Preserve file paths, error codes, and user-stated constraints when summarizing older tool rounds.",
    },
  };
}

export async function runSingleHarnessSend(scenario: Scenario, userMessage: string): Promise<{
  trace: TraceEvent[];
  runError?: string;
  durationMs: number;
  sandboxRoot?: string;
  sandboxCleanup?: () => void;
  modelSlug?: string;
}> {
  const t0 = Date.now();
  const trace: TraceEvent[] = [];

  let sandboxCleanup: (() => void) | undefined;
  let sandboxRoot: string | undefined;
  const envPatches = { ...(scenario.env ?? {}) };
  if (scenario.sandboxFixture) {
    const session = prepareSandboxLab(scenario.sandboxFixture);
    sandboxRoot = session.root;
    sandboxCleanup = session.cleanup;
    Object.assign(envPatches, mergeEvalManagedEnv(session.env));
  } else if (process.env["EVAL_SANDBOX_LAB"] === "1") {
    Object.assign(envPatches, mergeEvalManagedEnv({}));
  }

  const smokeFastModel =
    scenario.sandboxFixture &&
    scenario.tags?.includes("smoke") &&
    process.env["EVAL_SANDBOX_FAST_SMOKE"] !== "0"
      ? evalFastModelSlug()
      : undefined;

  const prevEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envPatches)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  applyEvalModelEnv();
  if (smokeFastModel) {
    process.env["AGENT_MODEL"] = smokeFastModel;
  }

  const provider = await resolveEvalProvider(runtimePreferences);
  const harness = new AgentHarness(
    makeEvalConfig(
      provider,
      scenario.maxRounds ?? 20,
      timeoutFor(scenario),
      sandboxRoot,
      Boolean(sandboxRoot)
    )
  );
  const mockApps = envPatches["AGENT_EVAL_LIMINAL_APPS_MOCK"] === "1";
  await registerAllTools(
    harness.registry,
    harness.emitter,
    harness,
    mockApps ? { appManager: createEvalMockAppManager() } : undefined
  );

  for (const mock of scenario.mocks ?? []) {
    const existing = harness.registry.get(mock.toolName);
    if (!existing) continue;
    const originalHandler = existing.handler;
    const mockFn = mock.handler;
    harness.registry.replace({
      ...existing,
      requiresApproval: false,
      handler: (args) => mockFn(args, originalHandler),
    });
  }

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
    "execution_state",
    "contract_transition",
    "contract_violation",
    "recovery_action",
    "drift_detected",
    "runtime_heartbeat",
    "vault_activity",
    "synthesis_check",
    "runtime_pref_detected",
    "runtime_pref_changed",
    "runtime_pref_persisted",
    "runtime_pref_rejected",
    "memory_retrieval_policy",
    "over_inference_check",
  ] as const satisfies ReadonlyArray<keyof AgentEventMap>;

  for (const evName of capturedEvents) {
    harness.emitter.on(evName, (payload) => {
      trace.push({ type: evName, payload, at: Date.now() });
    });
  }

  const interaction = scenario.harnessInteraction ?? "auto_approve";
  const destructiveTools = new Set([
    "delete_file",
    "run_shell",
    "write_file",
    "edit_file",
    "git_commit",
    "git_push",
    "git_rollback",
    "git_reset",
    "multi_file_apply",
  ]);

  harness.emitter.on("tool_approval", (payload) => {
    if (interaction === "reject_destructive" && destructiveTools.has(payload.name)) {
      payload.resolve({ decision: "reject" });
      return;
    }
    payload.resolve({ decision: "approve" });
  });

  harness.emitter.on("ask_user", (payload) => {
    payload.resolve("(eval auto-answer: N/A)");
  });

  let runError: string | undefined;
  try {
    await harness.send(userMessage);
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    trace.push({ type: "error", payload: { err: { message: runError } }, at: Date.now() });
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return { trace, runError, durationMs: Date.now() - t0, sandboxRoot, sandboxCleanup, modelSlug: provider.model };
}

/** Serialize JSONL writes when scenarios run in parallel. */
let evalJsonSinkChain: Promise<void> = Promise.resolve();

/** Await all pending appendEvalRunJsonLine writes (e.g. before summary). */
export async function flushEvalJsonSink(): Promise<void> {
  await evalJsonSinkChain;
}

export async function appendEvalRunJsonLine(result: ScenarioResult): Promise<void> {
  if (process.env["AGENT_EVAL_JSON_SINK"] !== "1") return;
  evalJsonSinkChain = evalJsonSinkChain.then(async () => {
    try {
      const dir = join(resolveWorkspaceRoot(), ".agent_eval_runs");
      await mkdir(dir, { recursive: true });
      const line =
        JSON.stringify({
          at: new Date().toISOString(),
          scenario: result.scenario,
          passed: result.passed,
          durationMs: result.durationMs,
          error: result.error ?? null,
          assertions: result.assertions,
          terminationReason: result.terminationReason ?? null,
          toolResultOkCount: result.toolResultOkCount ?? null,
          distinctToolsInvoked: result.distinctToolsInvoked ?? null,
          recoveryActionCount: result.recoveryActionCount ?? null,
          contractViolationCount: result.contractViolationCount ?? null,
          driftDetections: result.driftDetections ?? null,
          vaultActivities: result.vaultActivities ?? null,
        }) + "\n";
      await appendFile(join(dir, "runs.jsonl"), line, "utf8");
    } catch {
      /* optional */
    }
  });
  return evalJsonSinkChain;
}

/** Aggregate JSON summary for a full eval suite (requires AGENT_EVAL_JSON_SINK=1). */
export async function writeEvalRunSummary(
  results: ScenarioResult[],
  suiteStartedAt: number
): Promise<void> {
  if (process.env["AGENT_EVAL_JSON_SINK"] !== "1") return;
  try {
    const dir = join(resolveWorkspaceRoot(), ".agent_eval_runs");
    await mkdir(dir, { recursive: true });
    const ts = new Date(suiteStartedAt).toISOString().replace(/[:.]/g, "-");
    const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor((latencies.length - 1) * 0.5)] ?? 0;
    const p95 = latencies[Math.floor((latencies.length - 1) * 0.95)] ?? 0;
    const passed = results.filter((r) => r.passed).length;
    const payload = {
      at: new Date().toISOString(),
      suiteStartedAt: new Date(suiteStartedAt).toISOString(),
      total: results.length,
      passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      latencyMsSuite: { p50, p95, max: latencies[latencies.length - 1] ?? 0 },
      failures: results
        .filter((r) => !r.passed)
        .map((r) => ({
          scenario: r.scenario,
          error: r.error ?? null,
          terminationReason: r.terminationReason ?? null,
        })),
      perScenario: results.map((r) => ({
        scenario: r.scenario,
        passed: r.passed,
        durationMs: r.durationMs,
        terminationReason: r.terminationReason ?? null,
        toolResultOkCount: r.toolResultOkCount ?? null,
      })),
    };
    await writeFile(join(dir, `summary-${ts}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    /* optional */
  }
}

function checkAssertions(
  trace: TraceEvent[],
  assertions: ScenarioAssertion[],
  ctx?: ScenarioRunContext
): Array<{ name: string; passed: boolean }> {
  return assertions.map((a) => ({
    name: a.name,
    passed: (() => {
      try {
        return a.check(trace, ctx);
      } catch {
        return false;
      }
    })(),
  }));
}

/**
 * ReliabilityBench-style pass@k: same scenario, k independent harness runs.
 */
export async function runScenarioPassAtK(scenario: Scenario, k: number): Promise<ScenarioResult> {
  const runs: ScenarioResult[] = [];
  for (let i = 0; i < k; i++) {
    const r = await runScenario({
      ...scenario,
      passAtK: undefined,
      paraphrases: undefined,
      skipJsonSink: true,
    });
    runs.push(r);
  }
  const passed = runs.every((r) => r.passed);
  const assertions = runs.flatMap((r, i) =>
    r.assertions.map((a) => ({
      name: `[pass@${k} run ${i + 1}] ${a.name}`,
      passed: a.passed,
    }))
  );
  const last = runs[runs.length - 1]!;
  const out: ScenarioResult = {
    scenario: `${scenario.name} (pass@${k})`,
    passed,
    assertions,
    durationMs: runs.reduce((s, r) => s + r.durationMs, 0),
    error: runs.find((r) => r.error)?.error,
    terminationReason: last.terminationReason ?? null,
    toolResultOkCount: last.toolResultOkCount,
    distinctToolsInvoked: last.distinctToolsInvoked,
  };
  await appendEvalRunJsonLine(out);
  return out;
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  if (scenario.passAtK !== undefined && scenario.passAtK > 1) {
    return runScenarioPassAtK(scenario, scenario.passAtK);
  }

  const variants = [scenario.userMessage, ...(scenario.paraphrases ?? [])];
  const variantResults: Array<{
    msg: string;
    trace: TraceEvent[];
    runError?: string;
    durationMs: number;
    assertions: Array<{ name: string; passed: boolean }>;
    parityMeta?: import("./desktopParityRunner.js").DesktopParityRunMeta;
  }> = [];

  for (let vi = 0; vi < variants.length; vi++) {
    const msg = variants[vi]!;
    const sendResult =
      scenario.parityProfile === "desktop"
        ? await runDesktopParitySend(scenario, msg)
        : await runSingleHarnessSend(scenario, msg);
    const { trace, runError, durationMs, sandboxRoot, sandboxCleanup, parityMeta } = sendResult;
    const ctx: ScenarioRunContext | undefined = sandboxRoot ? { sandboxRoot } : undefined;
    const assertions = checkAssertions(trace, scenario.assertions, ctx);
    try {
      variantResults.push({ msg, trace, runError, durationMs, assertions, parityMeta });
    } finally {
      sandboxCleanup?.();
    }
  }

  const passed = variantResults.every(
    (vr) => vr.assertions.every((a) => a.passed) && !vr.runError
  );

  const assertions = variantResults.flatMap((vr, vi) =>
    vr.assertions.map((a) => ({
      name: variants.length > 1 ? `[ε${vi}] ${a.name}` : a.name,
      passed: a.passed,
    }))
  );

  const variantErrors = variantResults
    .map((vr, i) => (vr.runError ? `[variant ${i}] ${vr.runError}` : ""))
    .filter(Boolean);

  const telem = telemetryFromTraces(variantResults.map((vr) => vr.trace));
  const lastParity = variantResults[variantResults.length - 1]?.parityMeta;
  const out: ScenarioResult = {
    scenario: scenario.name,
    passed,
    assertions,
    durationMs: variantResults.reduce((s, vr) => s + vr.durationMs, 0),
    error: variantErrors[0],
    variantErrors: variantErrors.length ? variantErrors : undefined,
    ...(lastParity ? { parityMeta: lastParity } : {}),
    ...telem,
  };
  if (!scenario.skipJsonSink) {
    await appendEvalRunJsonLine(out);
  }
  await recordEvalScenarioOutcome({ scenario: scenario.name, passed: out.passed });
  if (out.passed && (!scenario.mocks || scenario.mocks.length === 0)) {
    const firstMsg = variants[0]!;
    void appendGoldenEvalRecord({
      scenario: scenario.name,
      prompt: firstMsg.slice(0, 4000),
      distinctTools: out.distinctToolsInvoked ?? [],
      durationMs: out.durationMs,
    });
  }
  return out;
}
