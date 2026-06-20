/**
 * Dynamic workflow tools (harness-scoped).
 *
 *   plan_workflow   — fast-model authors a validated WorkflowSpec (no execution)
 *   run_workflow    — execute a spec (or plan-then-execute a goal) via WorkflowRuntime;
 *                     approval-gated. Fans out sub-agents; results stay out of context.
 *   workflow_status — phase summaries / status for a prior run
 *   query_workflow  — BM25 over a run's stored per-agent outputs
 *
 * Each closes over the harness (forkChild + registry + provider config) so it
 * MUST be recreated per child via onChildCreated and excluded from the
 * parent→child registry copy (ORCHESTRATION_TOOL_NAMES).
 */
import OpenAI from "openai";
import {
  type ToolDefinition,
  type AgentHarness,
  type WorkflowSpec,
  type WorkflowReport,
  type WorkflowSummarizeInput,
  type WorkflowVerifyInput,
  parseWorkflowSpec,
  buildPlanWorkflowPrompt,
  WorkflowStore,
  WorkflowRuntime,
  getFastModelSlug,
  completeChatJson,
  effectiveHarnessEnvRaw,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

interface WorkflowRunRecord {
  store: WorkflowStore;
  goal: string;
  startedAt: string;
  report?: WorkflowReport;
}

// In-process registry of runs so status/query tools can find a prior run.
const WORKFLOW_RUNS = new Map<string, WorkflowRunRecord>();

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = effectiveHarnessEnvRaw(name)?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function workflowsEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_WORKFLOWS") !== "0";
}

function summarizeTimeoutMs(): number {
  return envInt("AGENT_WORKFLOW_TIMEOUT_MS", 1_800_000, 60_000, 3_600_000);
}

function phaseListText(spec: WorkflowSpec): string {
  return spec.phases
    .map((p, i) => {
      const deps = p.dependsOn?.length ? ` ←[${p.dependsOn.join(", ")}]` : "";
      const extras = [
        p.review === "adversarial" ? "review" : "",
        p.verify ? `verify:${p.verify.gate}(${p.verify.onFail})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `  ${i + 1}. ${p.id} [${p.kind}] — ${p.fanOut.tasks.length} agent(s)${deps}${extras ? ` {${extras}}` : ""}\n     ${p.goal}`;
    })
    .join("\n");
}

export function createWorkflowTools(harness: AgentHarness): {
  planWorkflowTool: ToolDefinition;
  runWorkflowTool: ToolDefinition;
  workflowStatusTool: ToolDefinition;
  queryWorkflowTool: ToolDefinition;
} {
  // Use the harness session client (managed inference or BYOK) — same as orchestration tools.
  // resolveProviderConfig() ignores the active managed session and would send Bedrock ids
  // (e.g. zai.glm-4.7-flash) to OpenRouter BYOK, which fails plan_workflow.
  function fastClient(): { client: OpenAI; fast: string } | null {
    const apiKey = harness.config.openRouterApiKey?.trim();
    if (!apiKey) return null;
    const overrideModel = effectiveHarnessEnvRaw("AGENT_WORKFLOW_MODEL")?.trim();
    const client = new OpenAI({ apiKey, baseURL: harness.config.baseURL });
    const fast = overrideModel || getFastModelSlug(harness.config.model);
    return { client, fast };
  }

  async function planSpec(goal: string): Promise<{ ok: true; spec: WorkflowSpec } | { ok: false; error: string }> {
    const fc = fastClient();
    if (!fc) return { ok: false, error: "provider API key missing — cannot plan a workflow" };
    const prompt = buildPlanWorkflowPrompt(goal, [
      "code_intel",
      "files_edit",
      "shell",
      "web",
      "memory_advanced",
      "git",
    ]);
    try {
      const jr = await completeChatJson(fc.client, {
        model: fc.fast,
        isFastModel: true,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 3000,
        temperature: 0.2,
        signal: AbortSignal.timeout(90_000),
        fallbackModel: harness.config.model,
        cache: false,
      });
      if (!jr.ok || !jr.parsed) return { ok: false, error: jr.ok ? "planner returned no JSON" : jr.error };
      const parsed = parseWorkflowSpec(jr.parsed);
      if (!parsed.ok) return { ok: false, error: `invalid plan: ${parsed.error}` };
      return { ok: true, spec: parsed.spec };
    } catch (e) {
      return { ok: false, error: `planning failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Fast-model phase distiller — folds many agent outputs into one compact summary.
  async function summarizePhase(input: WorkflowSummarizeInput): Promise<string> {
    const joined = input.results
      .map((r, i) => `[${r.kind ?? "agent"} ${i + 1} | ${r.ok ? "ok" : "failed"}] ${r.goal}\n${r.output.slice(0, 1500)}`)
      .join("\n\n");
    const fc = fastClient();
    if (!fc) return joined.slice(0, 1200);
    try {
      const jr = await completeChatJson(fc.client, {
        model: fc.fast,
        isFastModel: true,
        messages: [
          {
            role: "user",
            content:
              `Summarize these sub-agent findings for the phase goal: "${input.phase.goal}".\n` +
              "Return JSON: {\"summary\":\"concise factual synthesis — key results, decisions, unresolved issues; no fluff\"}.\n\n" +
              joined.slice(0, 12_000),
          },
        ],
        maxTokens: 800,
        temperature: 0.1,
        signal: AbortSignal.timeout(60_000),
      });
      const s = jr.ok && jr.parsed && typeof (jr.parsed as Record<string, unknown>)["summary"] === "string"
        ? ((jr.parsed as Record<string, unknown>)["summary"] as string)
        : "";
      return s.trim() || joined.slice(0, 1200);
    } catch {
      return joined.slice(0, 1200);
    }
  }

  // Verify gate — runs the registered tool's handler directly (read-only checks).
  async function verifyPhase(input: WorkflowVerifyInput): Promise<{ ok: boolean; detail: string }> {
    const { gate, command } = input;
    if (gate === "run_tests" || gate === "run_lint") {
      const tool = harness.registry.getAll().find((t) => t.name === gate);
      if (!tool) return { ok: true, detail: `${gate} not available — gate skipped` };
      try {
        const res = await tool.handler(command ? { command } : {});
        return res.ok
          ? { ok: true, detail: res.output.slice(0, 400) }
          : { ok: false, detail: res.error.slice(0, 1500) };
      } catch (e) {
        return { ok: false, detail: `${gate} threw: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    // critic gate: lightweight — a verify pass is better expressed as a review phase.
    return { ok: true, detail: "critic gate — express as a review phase; treated as pass" };
  }

  async function executeSpec(spec: WorkflowSpec, emit?: (t: string) => void): Promise<WorkflowReport> {
    const store = new WorkflowStore(spec.id);
    WORKFLOW_RUNS.set(spec.id, { store, goal: spec.goal, startedAt: new Date().toISOString() });
    const runtime = new WorkflowRuntime({
      spawn: (cfg) => harness.forkChild(cfg),
      summarize: summarizePhase,
      verify: verifyPhase,
      // Publish per-phase outputs to the session bus so later-phase sub-agents
      // can pull full upstream detail (read_agent_context / contextBusPrefix).
      publishContext: (key, summary, payload) =>
        harness.sharedBus.publishEnvelope(key, { type: "summary", summary, payload, at: Date.now() }, harness.taskId),
      store,
      maxConcurrent: envInt("AGENT_WORKFLOW_MAX_CONCURRENT", 4, 1, 16),
      maxAgents: envInt("AGENT_WORKFLOW_MAX_AGENTS", 64, 1, 500),
      onProgress: emit,
    });
    const report = await Promise.race([
      runtime.run(spec),
      new Promise<WorkflowReport>((_, reject) =>
        setTimeout(() => reject(new Error("workflow timed out")), summarizeTimeoutMs())
      ),
    ]);
    const rec = WORKFLOW_RUNS.get(spec.id);
    if (rec) rec.report = report;
    return report;
  }

  const planWorkflowTool = defineTool({
    name: "plan_workflow",
    description:
      "WHAT: Author a multi-phase workflow plan (sub-agents fan out per phase) for a goal — returns the spec WITHOUT running it.\n" +
      "WHEN: A task needs many coordinated agents or a repeatable audit/migration/research pattern, and you want to review the plan first.\n" +
      "NOT WHEN: A few sequential tool calls suffice — just do the work. To run after reviewing, pass the returned spec to run_workflow.\n" +
      "ARGS: goal — what the workflow should accomplish.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: { goal: { type: "string", description: "Objective for the workflow." } },
      required: ["goal"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!workflowsEnabled()) return { ok: false, error: "workflows are disabled (AGENT_WORKFLOWS=0)" };
      const goal = String(args["goal"] ?? "").trim();
      if (!goal) return { ok: false, error: "goal is required" };
      const planned = await planSpec(goal);
      if (!planned.ok) return { ok: false, error: planned.error };
      return {
        ok: true,
        output:
          `Workflow plan (${planned.spec.phases.length} phase(s)):\n${phaseListText(planned.spec)}\n\n` +
          `To run it: run_workflow({ "spec": <this JSON> }).\n\nSPEC:\n${JSON.stringify(planned.spec)}`,
      };
    },
  });

  const runWorkflowTool = defineTool({
    name: "run_workflow",
    description:
      "WHAT: Execute a dynamic workflow — fans out sub-agents across phases; intermediate results stay OUT of your context (only phase summaries return). Returns a synthesized report.\n" +
      "WHEN: Large audits/migrations/multi-angle research that need many agents. Prefer plan_workflow first to review the phases, then pass that spec here.\n" +
      "NOT WHEN: The task is small — work through it directly.\n" +
      "ARGS: spec — a WorkflowSpec object (from plan_workflow); OR goal — a string to plan-then-run. Per-agent detail is recoverable via query_workflow.",
    requiresApproval: true,
    dangerLevel: "cautious",
    parameters: {
      type: "object",
      properties: {
        spec: { type: "string", description: "A WorkflowSpec as JSON (preferred — copy the SPEC from plan_workflow)." },
        goal: { type: "string", description: "Alternatively, a goal to plan and run in one step." },
      },
      additionalProperties: false,
    },
    handler: async (args, emit) => {
      if (!workflowsEnabled()) return { ok: false, error: "workflows are disabled (AGENT_WORKFLOWS=0)" };
      let spec: WorkflowSpec;
      const rawSpec = args["spec"];
      if (rawSpec && typeof rawSpec === "object") {
        const parsed = parseWorkflowSpec(rawSpec);
        if (!parsed.ok) return { ok: false, error: `invalid spec: ${parsed.error}` };
        spec = parsed.spec;
      } else if (typeof rawSpec === "string" && rawSpec.trim()) {
        let json: unknown;
        try {
          json = JSON.parse(rawSpec);
        } catch {
          return { ok: false, error: "spec string is not valid JSON" };
        }
        const parsed = parseWorkflowSpec(json);
        if (!parsed.ok) return { ok: false, error: `invalid spec: ${parsed.error}` };
        spec = parsed.spec;
      } else {
        const goal = String(args["goal"] ?? "").trim();
        if (!goal) return { ok: false, error: "provide spec (from plan_workflow) or goal" };
        const planned = await planSpec(goal);
        if (!planned.ok) return { ok: false, error: planned.error };
        spec = planned.spec;
        emit?.(`[workflow] planned ${spec.phases.length} phase(s) for goal\n${phaseListText(spec)}\n`);
      }

      try {
        const report = await executeSpec(spec, emit);
        const text =
          `${report.finalReport}\n\n` +
          `run_id=${report.runId} · agents=${report.totalAgents}${report.truncated ? " (truncated)" : ""}\n` +
          `Query details: query_workflow({ "run_id": "${report.runId}", "query": "..." })`;
        return report.ok ? { ok: true, output: text } : { ok: false, error: text };
      } catch (e) {
        return { ok: false, error: `workflow run failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  const workflowStatusTool = defineTool({
    name: "workflow_status",
    description:
      "WHAT: Report a workflow run's phase summaries and outcome.\n" +
      "WHEN: After run_workflow, to see per-phase results without re-reading the full report.\n" +
      "ARGS: run_id — the id returned by run_workflow (omit to list known runs).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: { run_id: { type: "string", description: "Workflow run id." } },
      additionalProperties: false,
    },
    handler: async (args) => {
      const runId = String(args["run_id"] ?? "").trim();
      if (!runId) {
        const ids = [...WORKFLOW_RUNS.keys()];
        return { ok: true, output: ids.length ? `Known runs:\n${ids.join("\n")}` : "No workflow runs this session." };
      }
      const rec = WORKFLOW_RUNS.get(runId);
      if (!rec) return { ok: false, error: `no run "${runId}" in this session` };
      if (!rec.report) return { ok: true, output: `Run ${runId} ("${rec.goal}") is still in progress.` };
      const phases = rec.report.phases
        .map((p) => `  ${p.phaseId}${p.ok ? " ✓" : " ⚠"} — ${p.agentCount} agent(s)${p.iterations > 1 ? `, ${p.iterations} iters` : ""}\n     ${p.summary.slice(0, 240)}`)
        .join("\n");
      return {
        ok: true,
        output: `Run ${runId} ("${rec.goal}") — ${rec.report.ok ? "ok" : "issues"}, ${rec.report.totalAgents} agents\n${phases}`,
      };
    },
  });

  const queryWorkflowTool = defineTool({
    name: "query_workflow",
    description:
      "WHAT: Search a workflow run's per-agent outputs (stored out of context) by keyword.\n" +
      "WHEN: You need a specific detail from a sub-agent that isn't in the phase summary.\n" +
      "ARGS: run_id — the run id; query — keywords; top_k — max hits (default 5).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Workflow run id." },
        query: { type: "string", description: "Keywords to search agent outputs." },
        top_k: { type: "number", description: "Max hits (default 5)." },
      },
      required: ["run_id", "query"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const runId = String(args["run_id"] ?? "").trim();
      const query = String(args["query"] ?? "").trim();
      if (!runId || !query) return { ok: false, error: "run_id and query are required" };
      const rec = WORKFLOW_RUNS.get(runId);
      if (!rec) return { ok: false, error: `no run "${runId}" in this session` };
      const topK = typeof args["top_k"] === "number" ? Math.max(1, Math.min(20, args["top_k"] as number)) : 5;
      const hits = rec.store.query(query, topK);
      if (hits.length === 0) return { ok: true, output: `No matches for "${query}" in run ${runId}.` };
      return {
        ok: true,
        output: hits
          .map((h) => `[${h.phaseId}/${h.taskId.slice(0, 8)}] (score ${h.score.toFixed(2)})\n${h.excerpt}`)
          .join("\n\n---\n\n"),
      };
    },
  });

  return { planWorkflowTool, runWorkflowTool, workflowStatusTool, queryWorkflowTool };
}
