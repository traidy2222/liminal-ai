/**
 * Workflow runtime — interprets a WorkflowSpec by fanning out sub-agents per
 * phase, storing every result OUT OF the parent context (WorkflowStore), and
 * folding only a distilled per-phase summary back. Optional adversarial review
 * and a verify→iterate gate per phase.
 *
 * Deliberately decoupled from AgentHarness: it takes injected `spawn`,
 * `summarize`, and `verify` functions plus a WorkflowStore, so the heavy
 * orchestration logic is unit-testable with stubs. The workflow_tools layer
 * wires the real `harness.forkChild` and a fast-model summarizer.
 */
import type { ChildAgentConfig, SubtaskResult } from "./types.js";
import {
  topoSortPhases,
  inferWorkflowTaskFamilies,
  workflowNeedsWebTools,
  WORKFLOW_WEB_ACTIVATE_TOOLS,
  type WorkflowSpec,
  type WorkflowPhaseSpec,
  type WorkflowTaskSpec,
  type WorkflowVerifyGate,
} from "./workflow_spec.js";
import type { WorkflowStore, WorkflowAgentResult } from "./workflow_store.js";

export interface PhaseSummary {
  phaseId: string;
  summary: string;
  agentCount: number;
  ok: boolean;
  iterations: number;
}

export interface WorkflowReport {
  runId: string;
  goal: string;
  ok: boolean;
  phases: PhaseSummary[];
  totalAgents: number;
  truncated: boolean;
  finalReport: string;
}

export type WorkflowSpawn = (cfg: ChildAgentConfig) => { taskId: string; promise: Promise<SubtaskResult> };

export interface WorkflowSummarizeInput {
  phase: WorkflowPhaseSpec;
  results: WorkflowAgentResult[];
  priorSummaries: PhaseSummary[];
}
export interface WorkflowVerifyInput {
  phase: WorkflowPhaseSpec;
  gate: WorkflowVerifyGate;
  command?: string;
}

export interface WorkflowRuntimeDeps {
  spawn: WorkflowSpawn;
  summarize: (i: WorkflowSummarizeInput) => Promise<string>;
  /** Optional verification gate. When absent, verify phases are skipped (treated ok). */
  verify?: (i: WorkflowVerifyInput) => Promise<{ ok: boolean; detail: string }>;
  /**
   * Publish a phase's outputs to the session shared bus so later-phase
   * sub-agents can pull full upstream detail via read_agent_context (they only
   * get the concise digest inline). Wired to harness.sharedBus by the tool.
   */
  publishContext?: (key: string, summary: string, payload: string) => void;
  store: WorkflowStore;
  maxConcurrent: number;
  maxAgents: number;
  onProgress?: (text: string) => void;
  now?: () => number;
}

/** Shared-bus key prefix for a workflow run's per-phase context bundles. */
export function workflowContextPrefix(runId: string): string {
  return `ctx/wf/${runId}/`;
}

/** Bounded-concurrency map. Preserves input order in the result array. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

function digestSummaries(summaries: PhaseSummary[], max = 1800): string {
  if (summaries.length === 0) return "";
  const text = summaries.map((s) => `[${s.phaseId}] ${s.summary}`).join("\n");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function digestResults(results: WorkflowAgentResult[], max = 4000): string {
  const text = results
    .map((r, i) => `--- task ${i + 1} (${r.ok ? "ok" : "failed"}): ${r.goal}\n${r.output.slice(0, 800)}`)
    .join("\n\n");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export class WorkflowRuntime {
  private runId = "";

  constructor(private readonly deps: WorkflowRuntimeDeps) {}

  private progress(text: string): void {
    this.deps.onProgress?.(text);
  }

  async run(spec: WorkflowSpec): Promise<WorkflowReport> {
    this.runId = spec.id;
    const ordered = topoSortPhases(spec.phases);
    if (!ordered.ok) {
      return {
        runId: spec.id,
        goal: spec.goal,
        ok: false,
        phases: [],
        totalAgents: 0,
        truncated: false,
        finalReport: `Workflow aborted: ${ordered.error}`,
      };
    }

    const phaseSummaries: PhaseSummary[] = [];
    let spawned = 0;
    let truncated = false;
    let runOk = true;

    for (const phase of ordered.order) {
      const remaining = this.deps.maxAgents - spawned;
      if (remaining <= 0) {
        truncated = true;
        this.progress(`[workflow] agent budget (${this.deps.maxAgents}) exhausted — skipping phase ${phase.id}`);
        break;
      }
      let tasks = phase.fanOut.tasks;
      if (tasks.length > remaining) {
        tasks = tasks.slice(0, remaining);
        truncated = true;
      }

      const concurrency = Math.min(phase.concurrency ?? this.deps.maxConcurrent, this.deps.maxConcurrent);
      const maxIter = phase.verify?.onFail === "iterate" ? phase.converge?.maxIterations ?? 2 : 1;

      let phaseOk = true;
      let iterations = 0;
      let failureContext = "";
      let agentResults: WorkflowAgentResult[] = [];

      for (let iter = 1; iter <= maxIter; iter++) {
        iterations = iter;
        this.progress(
          `[workflow] phase ${phase.id} (${phase.kind}) — ${tasks.length} agent(s), wave ${concurrency}` +
            (iter > 1 ? `, retry ${iter}/${maxIter}` : "")
        );

        agentResults = await this.runFanOut(phase, tasks, phaseSummaries, failureContext);
        spawned += tasks.length;

        if (phase.review === "adversarial") {
          const review = await this.runReviewer(phase, agentResults);
          if (review) {
            agentResults = [...agentResults, review];
            spawned += 1;
          }
        }

        // Verify gate.
        if (phase.verify && this.deps.verify) {
          const v = await this.deps.verify({ phase, gate: phase.verify.gate, command: phase.verify.command });
          this.progress(`[workflow] verify ${phase.verify.gate} on ${phase.id}: ${v.ok ? "pass" : "fail"}`);
          if (v.ok) {
            phaseOk = true;
            break;
          }
          phaseOk = false;
          failureContext = v.detail.slice(0, 2000);
          if (phase.verify.onFail === "stop") break;
          // else iterate (loop continues until maxIter)
        } else {
          phaseOk = true;
          break;
        }
      }

      const summary = await this.deps.summarize({ phase, results: agentResults, priorSummaries: phaseSummaries });
      this.progress(`[workflow] ${phase.id} ${phaseOk ? "complete" : "incomplete"} — ${summary.slice(0, 200)}`);
      phaseSummaries.push({
        phaseId: phase.id,
        summary,
        agentCount: agentResults.length,
        ok: phaseOk,
        iterations,
      });

      // Publish this phase's full outputs to the shared bus so later-phase
      // sub-agents can pull upstream detail (auto-injected via contextBusPrefix,
      // and queryable on demand via read_agent_context).
      this.deps.publishContext?.(
        `${workflowContextPrefix(this.runId)}${phase.id}`,
        `${phase.id}: ${summary.slice(0, 140)}`,
        agentResults
          .map((r, i) => `[${r.kind ?? "agent"} ${i + 1} | ${r.ok ? "ok" : "failed"}] ${r.goal}\n${r.output}`)
          .join("\n\n")
          .slice(0, 8000)
      );

      if (!phaseOk && phase.verify?.onFail === "stop") {
        runOk = false;
        this.progress(`[workflow] phase ${phase.id} failed verification (onFail=stop) — aborting run`);
        break;
      }
      if (!phaseOk) runOk = false;
    }

    const finalReport = this.buildFinalReport(spec, phaseSummaries, runOk, truncated, spawned);
    await this.deps.store.writeManifest({ spec, report: { ok: runOk, phases: phaseSummaries, totalAgents: spawned } });

    return {
      runId: spec.id,
      goal: spec.goal,
      ok: runOk,
      phases: phaseSummaries,
      totalAgents: spawned,
      truncated,
      finalReport,
    };
  }

  private buildChildConfig(
    phase: WorkflowPhaseSpec,
    task: WorkflowTaskSpec,
    priorSummaries: PhaseSummary[],
    failureContext: string
  ): ChildAgentConfig {
    const contextParts = [
      `[WORKFLOW PHASE] ${phase.goal}`,
      priorSummaries.length > 0 ? `[PRIOR FINDINGS]\n${digestSummaries(priorSummaries)}` : "",
      task.additionalContext ? `[TASK CONTEXT] ${task.additionalContext}` : "",
      failureContext ? `[PREVIOUS ATTEMPT FAILED — FIX THIS]\n${failureContext}` : "",
    ].filter(Boolean);
    // Guarantee the sub-agent has the tools it needs: per-phase defaults UNION
    // the planner's declared families. Activation-gated families (shell,
    // code_intel, browser, …) would otherwise be invisible under lazy loading.
    const families = inferWorkflowTaskFamilies(task.goal, phase.kind, task.toolFamilies);
    const cfg: ChildAgentConfig = {
      goal: task.goal,
      userPrompt: task.goal,
      additionalContext: contextParts.join("\n\n"),
      activateFamilies: families,
      activateTools: workflowNeedsWebTools(families, task.goal)
        ? [...WORKFLOW_WEB_ACTIVATE_TOOLS]
        : undefined,
    };
    if (task.toolNames) cfg.toolNames = task.toolNames;
    // Auto-inject prior-phase context bundles from the shared bus (full upstream
    // detail, beyond the concise [PRIOR FINDINGS] digest). Same mechanism as
    // spawn_agent's contextBusPrefix — flows context downstream without the
    // sub-agent having to ask.
    if (priorSummaries.length > 0) {
      cfg.contextBusPrefix = workflowContextPrefix(this.runId);
    }
    return cfg;
  }

  private async runFanOut(
    phase: WorkflowPhaseSpec,
    tasks: WorkflowTaskSpec[],
    priorSummaries: PhaseSummary[],
    failureContext: string
  ): Promise<WorkflowAgentResult[]> {
    const concurrency = Math.min(phase.concurrency ?? this.deps.maxConcurrent, this.deps.maxConcurrent);
    let done = 0;
    const total = tasks.length;
    return mapPool(tasks, concurrency, async (task) => {
      const at = new Date(this.deps.now?.() ?? Date.now()).toISOString();
      this.progress(`[workflow] ${phase.id}: ▶ ${task.goal.slice(0, 70)}`);
      let result: WorkflowAgentResult;
      try {
        const { taskId, promise } = this.deps.spawn(this.buildChildConfig(phase, task, priorSummaries, failureContext));
        const sub = await promise;
        result = { phaseId: phase.id, taskId, goal: task.goal, ok: sub.ok, output: sub.output, at, kind: "agent" };
      } catch (err) {
        result = {
          phaseId: phase.id,
          taskId: `failed_${Math.random().toString(36).slice(2, 8)}`,
          goal: task.goal,
          ok: false,
          output: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          at,
          kind: "agent",
        };
      }
      await this.deps.store.add(result);
      done += 1;
      this.progress(
        `[workflow] ${phase.id}: ${result.ok ? "✓" : "✗"} (${done}/${total}) ${task.goal.slice(0, 60)}`
      );
      return result;
    });
  }

  private async runReviewer(
    phase: WorkflowPhaseSpec,
    results: WorkflowAgentResult[]
  ): Promise<WorkflowAgentResult | null> {
    const at = new Date(this.deps.now?.() ?? Date.now()).toISOString();
    const reviewGoal = `Adversarially review the findings below against the phase goal: "${phase.goal}". List concrete flaws, gaps, contradictions, and anything unverified. Be specific; do not restate the findings.`;
    const reviewFamilies = inferWorkflowTaskFamilies(reviewGoal, "review");
    const cfg: ChildAgentConfig = {
      goal: reviewGoal,
      userPrompt: reviewGoal,
      additionalContext: `[FINDINGS TO REVIEW]\n${digestResults(results)}`,
      activateFamilies: reviewFamilies,
      activateTools: workflowNeedsWebTools(reviewFamilies, reviewGoal)
        ? [...WORKFLOW_WEB_ACTIVATE_TOOLS]
        : undefined,
    };
    try {
      const { taskId, promise } = this.deps.spawn(cfg);
      const sub = await promise;
      const review: WorkflowAgentResult = {
        phaseId: phase.id,
        taskId,
        goal: "adversarial review",
        ok: sub.ok,
        output: sub.output,
        at,
        kind: "review",
      };
      await this.deps.store.add(review);
      return review;
    } catch {
      return null;
    }
  }

  private buildFinalReport(
    spec: WorkflowSpec,
    summaries: PhaseSummary[],
    ok: boolean,
    truncated: boolean,
    totalAgents: number
  ): string {
    const head = `Workflow "${spec.goal}" — ${ok ? "completed" : "completed with issues"} (${totalAgents} sub-agent${totalAgents === 1 ? "" : "s"}${truncated ? ", truncated at agent cap" : ""}).`;
    const body = summaries
      .map((s) => `## ${s.phaseId}${s.ok ? "" : " ⚠"}${s.iterations > 1 ? ` (${s.iterations} iters)` : ""}\n${s.summary}`)
      .join("\n\n");
    return `${head}\n\n${body}\n\nFull per-agent outputs are queryable via query_workflow.`;
  }
}
