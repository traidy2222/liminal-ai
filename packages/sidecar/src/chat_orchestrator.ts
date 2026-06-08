import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  completeChatJson,
  getFastModelSlug,
  resolveProviderConfig,
  type ProviderConfig,
} from "@liminal/core";
import { serverFrame, type ServerFrame } from "@liminal/protocol";
import type { ChatRegistry } from "./chat_registry.js";
import type { SessionBridge } from "./session_bridge.js";
import {
  buildHandoffRetryMessage,
  formatHandoffForUpstream,
  formatHandoffsForSynthesis,
  parseAndValidateWorkerHandoff,
  WORKER_HANDOFF_SCHEMA_HINT,
  type WorkerHandoff,
} from "./worker_handoff.js";

export type OrchestrationPhase =
  | "idle"
  | "planning"
  | "running"
  | "synthesizing"
  | "completed"
  | "failed"
  | "stopped";

export type WorkerStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface OrchestrationWorkerSnapshot {
  taskId: string;
  title: string;
  chatId?: string;
  status: WorkerStatus;
  summary?: string;
  handoff?: WorkerHandoff;
  error?: string;
}

export interface OrchestrationSnapshot {
  id: string;
  goal: string;
  status: OrchestrationPhase;
  phase?: string;
  yolo: boolean;
  workers: OrchestrationWorkerSnapshot[];
  synthesisChatId?: string;
  /** Mission Control chat that started this run. */
  parentChatId?: string;
  summary?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

interface PlannedTask {
  id: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  outOfScope?: string;
}

interface PlannedOrchestration {
  tasks: PlannedTask[];
  synthesisPrompt?: string;
}

/**
 * Meta-orchestrator: decomposes a high-level goal, spawns worker chats,
 * auto-resolves approval/ask_user gates, and synthesizes a final result.
 */
export class ChatOrchestrator {
  private snapshot: OrchestrationSnapshot = {
    id: "",
    goal: "",
    status: "idle",
    yolo: true,
    workers: [],
  };

  private readonly autopilotChats = new Set<string>();
  private runChain: Promise<void> = Promise.resolve();
  private aborted = false;
  private parentNotifiedForId: string | null = null;

  constructor(
    private readonly deps: {
      registry: ChatRegistry;
      repoRoot: string;
      provider: ProviderConfig;
      emit: (frame: ServerFrame) => void;
    }
  ) {}

  getSnapshot(): OrchestrationSnapshot {
    return structuredClone(this.snapshot);
  }

  handleFrame(frame: ServerFrame): void {
    const chatId = frame.chatId;
    if (!chatId || !this.autopilotChats.has(chatId)) return;

    if (frame.event === "tool_approval") {
      const data = frame.data as {
        callId: string;
        approvalNonce: string;
      };
      const bridge = this.deps.registry.get(chatId);
      bridge?.resolveApproval(
        data.callId,
        { decision: "approve" },
        data.approvalNonce
      );
      return;
    }

    if (frame.event === "ask_user") {
      const bridge = this.deps.registry.get(chatId);
      bridge?.resolveAskUser(
        "Proceed autonomously. Make reasonable assumptions and document them in your result."
      );
      return;
    }

  }

  start(
    goal: string,
    opts?: { maxWorkers?: number; yolo?: boolean; parentChatId?: string }
  ): OrchestrationSnapshot {
    const trimmed = goal.trim();
    if (!trimmed) {
      throw new Error("Goal is required.");
    }
    if (this.snapshot.status === "planning" || this.snapshot.status === "running" || this.snapshot.status === "synthesizing") {
      throw new Error("An orchestration is already running.");
    }

    const id = randomUUID();
    this.aborted = false;
    this.parentNotifiedForId = null;
    this.snapshot = {
      id,
      goal: trimmed,
      status: "planning",
      phase: "Decomposing goal into worker tasks…",
      yolo: opts?.yolo !== false,
      workers: [],
      parentChatId: opts?.parentChatId?.trim() || undefined,
      startedAt: Date.now(),
    };
    this.emitStatus();

    const maxWorkers = Math.max(1, Math.min(6, opts?.maxWorkers ?? 4));
    this.runChain = this.runChain
      .then(() => this.execute(id, trimmed, maxWorkers))
      .catch((err) => {
        if (this.snapshot.id !== id) return;
        this.snapshot.status = "failed";
        this.snapshot.error = err instanceof Error ? err.message : String(err);
        this.snapshot.finishedAt = Date.now();
        this.emitStatus();
      });

    return this.getSnapshot();
  }

  stop(orchestrationId?: string): boolean {
    if (orchestrationId && this.snapshot.id !== orchestrationId) return false;
    if (this.snapshot.status === "idle" || this.snapshot.status === "completed" || this.snapshot.status === "failed") {
      return false;
    }
    this.aborted = true;
    for (const chatId of this.autopilotChats) {
      this.deps.registry.get(chatId)?.abort();
    }
    this.snapshot.status = "stopped";
    this.snapshot.phase = "Stopped by user";
    this.snapshot.finishedAt = Date.now();
    this.emitStatus();
    this.autopilotChats.clear();
    return true;
  }

  private emitStatus(): void {
    this.deps.emit(serverFrame("orchestration_status", this.getSnapshot()));
    void this.maybeNotifyParentChat();
  }

  private async maybeNotifyParentChat(): Promise<void> {
    const snap = this.snapshot;
    const parentId = snap.parentChatId?.trim();
    if (!parentId || !snap.id) return;
    const terminal =
      snap.status === "completed" || snap.status === "failed" || snap.status === "stopped";
    if (!terminal || snap.finishedAt == null) return;
    if (this.parentNotifiedForId === snap.id) return;

    const bridge = this.deps.registry.get(parentId);
    if (!bridge) return;
    if (bridge.harness.getIsRunning()) return;

    this.parentNotifiedForId = snap.id;
    const outcome =
      snap.status === "completed" && snap.summary?.trim()
        ? snap.summary.trim()
        : snap.error?.trim() || `Mission ended with status: ${snap.status}.`;
    const workers = snap.workers
      .filter((w) => w.handoff)
      .map(
        (w) =>
          `- ${w.title}: ${w.handoff!.status}` +
          (w.handoff!.artifacts.length ? ` (${w.handoff!.artifacts.join(", ")})` : "")
      )
      .join("\n");
    const message = [
      `[Mission finished — id ${snap.id}, status: ${snap.status}]`,
      "",
      outcome,
      workers ? `\nWorker handoffs:\n${workers}` : "",
      "",
      "Summarize this outcome for the user: what shipped, gaps, and sensible next steps.",
    ]
      .filter((line) => line !== "")
      .join("\n");

    try {
      await bridge.sendUserMessage(message, { freshContext: false });
    } catch {
      this.parentNotifiedForId = null;
    }
  }

  private async execute(id: string, goal: string, maxWorkers: number): Promise<void> {
    const plan = await this.plan(goal, maxWorkers);
    if (this.aborted || this.snapshot.id !== id) return;

    this.snapshot.status = "running";
    this.snapshot.phase = `Running ${plan.tasks.length} worker chat(s)…`;
    this.snapshot.workers = plan.tasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      status: "pending" as const,
    }));
    this.emitStatus();

    const waves = topologicalWaves(plan.tasks);
    const handoffs = new Map<string, WorkerHandoff>();

    for (const wave of waves) {
      if (this.aborted) break;
      await Promise.all(
        wave.map(async (task) => {
          const worker = this.snapshot.workers.find((w) => w.taskId === task.id);
          if (!worker || worker.status === "skipped") return;

          const upstream = (task.dependsOn ?? [])
            .map((depId) => {
              const dep = this.snapshot.workers.find((w) => w.taskId === depId);
              const handoff = handoffs.get(depId) ?? dep?.handoff;
              if (!handoff || !dep) return "";
              return formatHandoffForUpstream(depId, dep.title, handoff);
            })
            .filter(Boolean)
            .join("\n\n");

          try {
            const handoff = await this.runWorker(goal, task, plan.tasks, upstream);
            handoffs.set(task.id, handoff);
            worker.status = "done";
            worker.handoff = handoff;
            worker.summary = handoff.summary;
          } catch (err) {
            worker.status = "failed";
            worker.error = err instanceof Error ? err.message : String(err);
          }
          this.emitStatus();
        })
      );
    }

    if (this.aborted || this.snapshot.id !== id) return;

    const anyOk = this.snapshot.workers.some((w) => w.status === "done");
    if (!anyOk) {
      this.snapshot.status = "failed";
      this.snapshot.error = "All worker chats failed.";
      this.snapshot.finishedAt = Date.now();
      this.emitStatus();
      return;
    }

    this.snapshot.status = "synthesizing";
    this.snapshot.phase = "Synthesizing final result…";
    this.emitStatus();

    try {
      const synthesis = await this.runSynthesis(goal, plan.synthesisPrompt, handoffs);
      this.snapshot.summary = synthesis.text;
      this.snapshot.synthesisChatId = synthesis.chatId;
      this.snapshot.status = "completed";
      this.snapshot.phase = "Done";
    } catch (err) {
      this.snapshot.status = "failed";
      this.snapshot.error = err instanceof Error ? err.message : String(err);
    }
    this.snapshot.finishedAt = Date.now();
    this.emitStatus();
  }

  private async plan(goal: string, maxWorkers: number): Promise<PlannedOrchestration> {
    const provider = resolveProviderConfig();
    if (!provider.apiKey) {
      return fallbackPlan(goal, maxWorkers);
    }

    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
    const fast = getFastModelSlug(provider.model);
    const prompt = [
      "You are a mission planner for a multi-chat agent orchestrator.",
      `Decompose the user's goal into 1–${maxWorkers} narrow worker tasks.`,
      "CRITICAL: tasks must be MECE — mutually exclusive. Each worker owns ONE slice only.",
      "Never give every worker the full parent goal as their prompt. Each prompt is a single bounded deliverable.",
      "Each worker gets its own chat and will try to do everything unless you scope them tightly.",
      "Return JSON only:",
      '{ "tasks": [{ "id": "t1", "title": "short label", "prompt": "ONLY what this worker builds/does", "acceptanceCriteria": "how we know this slice is done", "outOfScope": "what this worker must NOT touch", "dependsOn": [] }], "synthesisPrompt": "optional merge instructions" }',
      "dependsOn: only when a task truly needs another task's output. Prefer parallel non-overlapping tasks.",
      "prompt: imperative, narrow, one deliverable — not a copy of the parent goal.",
      "outOfScope: explicitly list sibling work and full-mission completion.",
      "",
      `PARENT GOAL (split this — do not paste verbatim into every worker prompt):\n${goal}`,
    ].join("\n");

    try {
      const jr = await completeChatJson(client, {
        model: fast,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2500,
        temperature: 0.2,
        signal: AbortSignal.timeout(90_000),
      });
      if (!jr.ok || !jr.parsed) return fallbackPlan(goal, maxWorkers);
      const parsed = parsePlan(jr.parsed, maxWorkers);
      return parsed ?? fallbackPlan(goal, maxWorkers);
    } catch {
      return fallbackPlan(goal, maxWorkers);
    }
  }

  private async runWorker(
    goal: string,
    task: PlannedTask,
    allTasks: PlannedTask[],
    upstreamBlock: string
  ): Promise<WorkerHandoff> {
    const worker = this.snapshot.workers.find((w) => w.taskId === task.id);
    if (!worker) throw new Error("Worker state missing");

    worker.status = "running";
    this.emitStatus();

    const bridge = await this.deps.registry.create({
      title: `[Worker] ${task.title}`.slice(0, 80),
    });
    worker.chatId = bridge.chatId;
    this.deps.registry.touch(bridge.chatId, task.title);
    this.autopilotChats.add(bridge.chatId);
    this.emitStatus();

    await this.waitForBridgeReady(bridge);

    const message = buildWorkerMessage(goal, task, allTasks, upstreamBlock);

    // sendUserMessage already awaits harness.send() through turn completion.
    // Do not also wait on turn_end — it fires before running=false is cleared.
    await bridge.sendUserMessage(message, { freshContext: true });

    let handoffResult = parseAndValidateWorkerHandoff(
      bridge.harness.getLastAssistantMessage().trim()
    );
    for (let attempt = 0; !handoffResult.ok && attempt < 2; attempt++) {
      await bridge.sendUserMessage(buildHandoffRetryMessage(handoffResult.error), {
        freshContext: false,
      });
      handoffResult = parseAndValidateWorkerHandoff(
        bridge.harness.getLastAssistantMessage().trim()
      );
    }
    if (!handoffResult.ok) {
      throw new Error(`Invalid worker handoff: ${handoffResult.error}`);
    }

    this.autopilotChats.delete(bridge.chatId);
    return handoffResult.handoff;
  }

  private async runSynthesis(
    goal: string,
    synthesisPrompt: string | undefined,
    handoffs: Map<string, WorkerHandoff>
  ): Promise<{ chatId: string; text: string }> {
    const bridge = await this.deps.registry.create({
      title: `[Orchestrator] ${goal.slice(0, 48)}`,
    });
    this.autopilotChats.add(bridge.chatId);
    this.emitStatus();

    await this.waitForBridgeReady(bridge);

    const structuredWorkers = this.snapshot.workers
      .filter((w) => w.handoff)
      .map((w) => ({
        taskId: w.taskId,
        title: w.title,
        handoff: w.handoff!,
      }));
    const workerDigest = formatHandoffsForSynthesis(structuredWorkers);

    const message = [
      "[ORCHESTRATION SYNTHESIS — merge only]",
      "You are the synthesis agent. Do NOT implement, fix, or extend the project.",
      "Do NOT spawn workers, run workflows, or redo tasks the workers already completed.",
      "Your only job: merge the structured worker handoffs (JSON) into one clear final answer.",
      "",
      `Original goal (context): ${goal}`,
      synthesisPrompt?.trim() ? `Merge instructions: ${synthesisPrompt.trim()}` : "",
      "",
      "Cross-check each handoff:",
      "- status=done but artifacts empty when code/files were expected → call out as a gap",
      "- status=blocked or partial → include blockers and what remains",
      "- Union artifacts and commandsRun; dedupe paths",
      "",
      "Structured worker handoffs (JSON array):",
      "```json",
      workerDigest,
      "```",
      "",
      "Deliver: what was accomplished, key artifacts/paths, verification (commandsRun), gaps/blockers, next steps.",
    ]
      .filter(Boolean)
      .join("\n");

    await bridge.sendUserMessage(message, { freshContext: true });

    const text = bridge.harness.getLastAssistantMessage().trim();
    this.autopilotChats.delete(bridge.chatId);
    if (!text) throw new Error("Synthesis produced no output.");
    return { chatId: bridge.chatId, text };
  }

  private async waitForBridgeReady(bridge: SessionBridge): Promise<void> {
    await bridge.beginSession();
    for (let i = 0; i < 120; i++) {
      if (this.aborted) throw new Error("Orchestration stopped");
      if (!bridge.isAwaitingPersonaBootstrap && !bridge.harness.getIsRunning()) return;
      await sleep(500);
    }
    if (bridge.isAwaitingPersonaBootstrap) {
      throw new Error("Complete persona bootstrap before running orchestrations.");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePlan(raw: unknown, maxWorkers: number): PlannedOrchestration | null {
  if (!raw || typeof raw !== "object") return null;
  const tasksRaw = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) return null;

  const tasks: PlannedTask[] = [];
  for (const [i, entry] of tasksRaw.entries()) {
    if (i >= maxWorkers) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = String(e.id ?? `t${i + 1}`).trim() || `t${i + 1}`;
    const title = String(e.title ?? `Task ${i + 1}`).trim() || `Task ${i + 1}`;
    const prompt = String(e.prompt ?? e.goal ?? "").trim();
    if (!prompt) continue;
    const dependsOn = Array.isArray(e.dependsOn)
      ? e.dependsOn.map((d) => String(d)).filter(Boolean)
      : undefined;
    const acceptanceCriteria =
      typeof e.acceptanceCriteria === "string" ? e.acceptanceCriteria.trim() : undefined;
    const outOfScope = typeof e.outOfScope === "string" ? e.outOfScope.trim() : undefined;
    tasks.push({ id, title, prompt, dependsOn, acceptanceCriteria, outOfScope });
  }
  if (tasks.length === 0) return null;

  const synthesisPrompt = (raw as { synthesisPrompt?: unknown }).synthesisPrompt;
  return {
    tasks,
    synthesisPrompt: typeof synthesisPrompt === "string" ? synthesisPrompt : undefined,
  };
}

function fallbackPlan(goal: string, maxWorkers: number): PlannedOrchestration {
  if (maxWorkers <= 1) {
    return {
      tasks: [{ id: "t1", title: "Execute mission", prompt: goal }],
    };
  }
  return {
    tasks: [
      {
        id: "t1",
        title: "Research & plan",
        prompt:
          "Research the problem and write a concrete implementation plan (steps, files, risks). Do not implement code yet.",
        acceptanceCriteria:
          "A written plan with ordered steps another worker can follow; JSON handoff with status=done.",
        outOfScope: "Writing production code, running the full mission end-to-end, integration testing.",
      },
      {
        id: "t2",
        title: "Execute plan",
        prompt:
          "Implement ONLY the steps in the upstream plan. Do not redo broad research or expand scope beyond the plan.",
        acceptanceCriteria:
          "Plan steps implemented; JSON handoff lists artifacts changed and commandsRun for verification.",
        outOfScope:
          "Mission-wide research, tasks outside the upstream plan, redoing t1's planning work.",
        dependsOn: ["t1"],
      },
    ],
    synthesisPrompt: "Merge the plan and execution into one cohesive deliverable.",
  };
}

function buildWorkerMessage(
  parentGoal: string,
  task: PlannedTask,
  allTasks: PlannedTask[],
  upstreamBlock: string
): string {
  const siblings = allTasks
    .filter((t) => t.id !== task.id)
    .map((t) => `- ${t.id} ${t.title}: ${t.prompt.slice(0, 160)}`)
    .join("\n");

  const acceptance =
    task.acceptanceCriteria?.trim() ||
    "Your assigned slice is implemented or answered; nothing outside your prompt remains.";

  const forbidden = [
    task.outOfScope?.trim(),
    siblings ? `Other workers own these slices (do NOT do their work):\n${siblings}` : "",
    "- Completing the full parent mission yourself",
    "- Spawning sub-agents or workflows to cover sibling tasks",
    "- Broad repo audits unless your assignment explicitly requires them",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `[ORCHESTRATION WORKER ${task.id}] — scoped slice only`,
    `Role: ${task.title}`,
    "",
    "YOU ARE NOT THE MISSION OWNER. Execute ONLY your assignment, then stop.",
    "",
    "## Your assignment (do only this)",
    task.prompt,
    "",
    "## Done when",
    acceptance,
    "",
    "## Out of scope",
    forbidden,
    upstreamBlock ? `## Upstream results (use as input; do not repeat their work)\n${upstreamBlock}` : "",
    "",
    "## Rules",
    "- Do not ask the user questions — make reasonable assumptions.",
    "- Stop as soon as acceptance criteria are met; do not keep going.",
    "- **File edits:** grep_file or read_file → edit_file for changes to existing files. write_file mode=create only for new paths. Do not whole-file overwrite existing code — the harness blocks it.",
    "## Required handoff (mandatory)",
    "Your final message MUST end with a ```json code fence using exactly this schema:",
    WORKER_HANDOFF_SCHEMA_HINT,
    "- Put human-readable prose in the summary field inside JSON — not a separate ## Result section.",
    "- artifacts: repo paths you created or changed; commandsRun: tests/builds you ran; decisions: non-obvious choices.",
    "- status=blocked requires non-empty blockers; status=partial when useful work shipped but slice incomplete.",
    "",
    `Parent mission (context only — NOT your job to finish): ${parentGoal.slice(0, 400)}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function topologicalWaves(tasks: PlannedTask[]): PlannedTask[][] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const remaining = new Set(tasks.map((t) => t.id));
  const waves: PlannedTask[][] = [];

  while (remaining.size > 0) {
    const wave: PlannedTask[] = [];
    for (const id of remaining) {
      const task = byId.get(id)!;
      const deps = task.dependsOn ?? [];
      if (deps.every((d) => !remaining.has(d))) {
        wave.push(task);
      }
    }
    if (wave.length === 0) {
      // Cycle or bad deps — run everything left in one wave.
      for (const id of remaining) {
        wave.push(byId.get(id)!);
      }
      waves.push(wave);
      break;
    }
    for (const t of wave) remaining.delete(t.id);
    waves.push(wave);
  }
  return waves;
}
