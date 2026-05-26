/**
 * PASTE speculation scheduler.
 *
 * Sits between the ReAct loop and the dispatcher. When the model is about to
 * produce its next tool call (e.g. the assistant message just dispatched a
 * batch and we're waiting for the next stream), the scheduler queries the
 * pattern store for high-probability predictions and dispatches them
 * speculatively. When the model actually emits one of the predicted calls,
 * the in-flight result is "promoted" — attached to the real call-id and
 * skipped at dispatch time. Speculations that don't match get discarded
 * (their cost was wasted compute, not correctness — read-only by policy).
 *
 * Safety: the miner already excludes side-effecting tools from `nextTool`
 * (see `isSpeculatable`). The scheduler additionally checks the registered
 * `ToolDefinition.dangerLevel`. A tool is eligible only when it is registered,
 * active, `dangerLevel ∈ {"safe", undefined}`, and not `requiresApproval`.
 *
 * Budget: total in-flight speculative wall-clock is bounded by
 * AGENT_PASTE_BUDGET_MS (default 2000ms). Once exceeded, new speculations are
 * skipped until in-flight jobs settle.
 *
 * Per the PASTE paper (arXiv:2603.18897), Top-1 prediction accuracy is ~28%
 * and hit rate is ~94% across Top-3, so even modest speculation budgets pay
 * off when the underlying tool is web_fetch / read_file / grep_file with
 * meaningful latency.
 */
import type { ToolDefinition, ToolResult } from "./types.js";

export interface SpeculationCandidate {
  toolName: string;
  /** Args to pass to the dispatcher. The miner does NOT predict args today;
   * callers may inject from prior tool output (e.g. URLs harvested from a
   * web_search result). When args are unknown, the scheduler skips. */
  args: Record<string, unknown>;
  /** Pattern probability that drove this candidate (0–1). */
  probability: number;
  /** Estimated wall-clock savings if the prediction lands (ms). */
  estimatedLatencyMs: number;
}

export interface InFlightSpeculation {
  toolName: string;
  argsKey: string;
  /** Promise that resolves with the dispatcher's ToolResult. */
  promise: Promise<ToolResult>;
  /** Wall-clock start time for budget accounting. */
  startedAt: number;
  /** Set true once promoted (i.e. matched a real model call-id). */
  promoted: boolean;
}

export interface SchedulerOptions {
  /** Hard cap on concurrent in-flight speculations. Default 2. */
  maxConcurrent?: number;
  /** Aggregate wall-clock budget for in-flight speculations (ms). Default 2000. */
  budgetMs?: number;
  /** Minimum prediction probability to bother speculating. Default 0.5. */
  minProbability?: number;
}

export class PasteScheduler {
  private readonly inFlight = new Map<string, InFlightSpeculation>();
  private readonly maxConcurrent: number;
  private readonly budgetMs: number;
  private readonly minProbability: number;
  private wastedSpeculations = 0;
  private promotedSpeculations = 0;

  constructor(opts: SchedulerOptions = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 2);
    this.budgetMs = Math.max(0, opts.budgetMs ?? 2000);
    this.minProbability = Math.max(0, Math.min(1, opts.minProbability ?? 0.5));
  }

  /** True when the candidate is eligible to be dispatched speculatively. */
  isEligible(candidate: SpeculationCandidate, toolDef: ToolDefinition | undefined): boolean {
    if (!toolDef) return false;
    if (toolDef.requiresApproval) return false;
    if (toolDef.dangerLevel && toolDef.dangerLevel !== "safe") return false;
    if (candidate.probability < this.minProbability) return false;
    return true;
  }

  /** True when there is room within the configured budget to start a new speculation. */
  hasBudget(now: number = Date.now()): boolean {
    if (this.inFlight.size >= this.maxConcurrent) return false;
    if (this.budgetMs <= 0) return true;
    let consumed = 0;
    for (const job of this.inFlight.values()) {
      consumed += Math.max(0, now - job.startedAt);
    }
    return consumed < this.budgetMs;
  }

  /**
   * Start a speculative dispatch. Returns the speculation record so the
   * caller can later promote it. Caller must already have checked
   * `isEligible` and `hasBudget`.
   */
  start(
    candidate: SpeculationCandidate,
    argsKey: string,
    dispatchFn: () => Promise<ToolResult>
  ): InFlightSpeculation {
    const existing = this.findInFlight(candidate.toolName, argsKey);
    if (existing) return existing;
    const startedAt = Date.now();
    const promise = dispatchFn().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `speculation failed: ${msg}` } as ToolResult;
    });
    const job: InFlightSpeculation = {
      toolName: candidate.toolName,
      argsKey,
      promise,
      startedAt,
      promoted: false,
    };
    this.inFlight.set(this.keyOf(candidate.toolName, argsKey), job);
    // Auto-cleanup when the dispatch settles so wasted speculations don't
    // count against future budgets.
    void promise.finally(() => {
      if (!job.promoted) {
        this.inFlight.delete(this.keyOf(candidate.toolName, argsKey));
        this.wastedSpeculations += 1;
      }
    });
    return job;
  }

  /**
   * The model just emitted a real tool call. If an in-flight speculation
   * matches by (toolName + argsKey), return its promise and mark it promoted.
   * Returns null when no speculation matches — caller dispatches normally.
   */
  promote(toolName: string, argsKey: string): Promise<ToolResult> | null {
    const job = this.findInFlight(toolName, argsKey);
    if (!job) return null;
    job.promoted = true;
    this.inFlight.delete(this.keyOf(toolName, argsKey));
    this.promotedSpeculations += 1;
    return job.promise;
  }

  /** Discard all in-flight speculations (e.g. on turn end / error). */
  reset(): void {
    this.inFlight.clear();
  }

  /** Telemetry snapshot for `self_telemetry`. */
  stats(): { inFlight: number; promoted: number; wasted: number } {
    return {
      inFlight: this.inFlight.size,
      promoted: this.promotedSpeculations,
      wasted: this.wastedSpeculations,
    };
  }

  private keyOf(toolName: string, argsKey: string): string {
    return `${toolName}::${argsKey}`;
  }

  private findInFlight(toolName: string, argsKey: string): InFlightSpeculation | undefined {
    return this.inFlight.get(this.keyOf(toolName, argsKey));
  }
}
