/**
 * Task persistence — checkpoint and resume multi-session work.
 *
 * task_checkpoint() saves structured progress to memory under task:{id}.
 * resume_task()     retrieves the most recent (or specific) in-progress task
 *                   and re-injects it as context for the current session.
 *
 * Enables truly long-horizon work that spans multiple conversation sessions.
 * Paper: TAPAS (arXiv:2402.07483) — persistent task state with structured resumption.
 */
import { defineTool } from "./helpers.js";
import { loadNotes, atomicUpdate } from "./notes_store.js";
import {
  createTaskWorldSnapshot,
  persistTaskWorldEvent,
  resolveHarnessEnvRaw,
} from "@liminal/core";

interface TaskState {
  id: string;
  goal: string;
  progress_summary: string;
  next_steps: string[];
  artifacts: string[];
  status: "in_progress" | "completed" | "abandoned";
  createdAt: string;
  updatedAt: string;
  execution_state?: {
    mission?: string;
    active_contract?: string;
    drift_score?: number;
    unresolved_questions?: string[];
    recovery_count?: number;
  };
}

export const taskCheckpointTool = defineTool({
  name: "task_checkpoint",
  description:
    "WHAT: Save structured task progress to memory so it can be resumed in a future session.\n" +
    "WHEN: Before ending a long task, when switching contexts, or after completing a major milestone.\n" +
    "ARGS: id — short identifier for this task (e.g. 'auth-refactor'); " +
    "goal — the original task description; " +
    "progress_summary — what has been done so far; " +
    "next_steps — ordered list of remaining actions; " +
    "artifacts — optional list of file paths or URLs created/modified; " +
    "status — 'in_progress' (default), 'completed', or 'abandoned'.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Short task identifier (e.g. 'auth-refactor')" },
      goal: { type: "string", description: "The original goal or task description" },
      progress_summary: { type: "string", description: "What has been accomplished so far" },
      next_steps: {
        type: "array",
        items: { type: "string" },
        description: "Ordered list of remaining actions to complete the task",
      },
      artifacts: {
        type: "array",
        items: { type: "string" },
        description: "File paths, URLs, or other outputs created/modified (optional)",
      },
      status: {
        type: "string",
        enum: ["in_progress", "completed", "abandoned"],
        description: "Task status (default: in_progress)",
      },
      execution_state: {
        type: "object",
        properties: {
          mission: { type: "string" },
          active_contract: { type: "string" },
          drift_score: { type: "number" },
          unresolved_questions: { type: "array", items: { type: "string" } },
          recovery_count: { type: "number" },
        },
        description: "Optional long-horizon runtime state snapshot",
      },
    },
    required: ["id", "goal", "progress_summary", "next_steps"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = args["id"] as string;
    const status = (args["status"] as TaskState["status"] | undefined) ?? "in_progress";
    const now = new Date().toISOString();

    // Read existing task to preserve createdAt
    const notes = await loadNotes();
    const taskKey = `task:${id}`;
    let existing: Partial<TaskState> | null = null;
    if (notes[taskKey]) {
      try { existing = JSON.parse(notes[taskKey]) as Partial<TaskState>; } catch { /* ignore malformed */ }
    }

    const task: TaskState = {
      id,
      goal: args["goal"] as string,
      progress_summary: args["progress_summary"] as string,
      next_steps: args["next_steps"] as string[],
      artifacts: (args["artifacts"] as string[] | undefined) ?? [],
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      execution_state: (args["execution_state"] as TaskState["execution_state"] | undefined) ?? existing?.execution_state,
    };

    await atomicUpdate((n) => ({ ...n, [taskKey]: JSON.stringify(task) }));
    let taskWorldNote = "";
    if (resolveHarnessEnvRaw("AGENT_TASK_WORLDS", null) !== "0") {
      try {
        const world = createTaskWorldSnapshot({
          id,
          objective: task.goal,
          successCriteria: task.next_steps.map((s) => `Complete: ${s}`),
          now: Date.now(),
        });
        await persistTaskWorldEvent(world.id, null, { type: "created", at: world.createdAt, world });
        taskWorldNote = `\nTask World: .agent_task_worlds/${world.id}/snapshot.json`;
      } catch {
        /* task_checkpoint remains useful even if Task World persistence fails */
      }
    }

    const statusLabel = status === "completed" ? "✓ completed" : status === "abandoned" ? "✗ abandoned" : "⟳ in progress";
    return {
      ok: true,
      output:
        `Task "${id}" saved [${statusLabel}]\n` +
        `Goal: ${task.goal}\n` +
        `Progress: ${task.progress_summary.slice(0, 120)}${task.progress_summary.length > 120 ? "…" : ""}\n` +
        `Next steps: ${task.next_steps.length} remaining\n` +
        (task.execution_state
          ? `Execution state: mission="${task.execution_state.mission ?? "n/a"}" contract="${task.execution_state.active_contract ?? "n/a"}" drift=${task.execution_state.drift_score ?? 0}\n`
          : "") +
        `Key: ${taskKey}` +
        taskWorldNote,
    };
  },
});

export const resumeTaskTool = defineTool({
  name: "resume_task",
  description:
    "WHAT: Retrieve a previously checkpointed task to continue work from where you left off.\n" +
    "WHEN: At the start of a session when you know there is ongoing work to continue.\n" +
    "ARGS: id — specific task ID to resume (optional — omit to list all in-progress tasks or get most recent).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Task ID to resume (optional — omit to list all in-progress tasks)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = args["id"] as string | undefined;
    const notes = await loadNotes();

    const taskEntries = Object.entries(notes)
      .filter(([k]) => k.startsWith("task:"))
      .map(([, v]) => {
        try { return JSON.parse(v) as TaskState; }
        catch { return null; }
      })
      .filter((t): t is TaskState => t !== null);

    if (id) {
      const task = taskEntries.find((t) => t.id === id);
      if (!task) {
        return { ok: false, error: `No task found with id "${id}". Use resume_task() without an id to list all tasks.` };
      }
      return { ok: true, output: formatTask(task) };
    }

    // No id — list in-progress tasks or return most recent
    const inProgress = taskEntries
      .filter((t) => t.status === "in_progress")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    if (inProgress.length === 0) {
      const all = taskEntries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (all.length === 0) return { ok: true, output: "(no tasks checkpointed yet)" };
      return {
        ok: true,
        output:
          "No in-progress tasks. All tasks:\n" +
          all.map((t) => `  ${t.id} [${t.status}] — ${t.goal.slice(0, 60)}`).join("\n"),
      };
    }

    if (inProgress.length === 1) {
      return { ok: true, output: formatTask(inProgress[0]!) };
    }

    return {
      ok: true,
      output:
        `${inProgress.length} in-progress tasks (most recent first):\n` +
        inProgress
          .map(
            (t, i) =>
              `  ${i + 1}. ${t.id} (updated ${t.updatedAt.slice(0, 10)}) — ${t.goal.slice(0, 60)}`
          )
          .join("\n") +
        "\n\nUse resume_task({ id: \"<id>\" }) to load a specific task.",
    };
  },
});

function formatTask(task: TaskState): string {
  const nextStepList = task.next_steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const artifactList = task.artifacts.length > 0 ? `\nArtifacts: ${task.artifacts.join(", ")}` : "";
  const runtime = task.execution_state
    ? `\nRuntime state: mission=${task.execution_state.mission ?? "n/a"}, active_contract=${task.execution_state.active_contract ?? "n/a"}, drift=${task.execution_state.drift_score ?? 0}`
    : "";
  return (
    `[RESUMED TASK: ${task.id}]\n` +
    `Goal: ${task.goal}\n\n` +
    `Progress so far:\n${task.progress_summary}\n\n` +
    `Next steps:\n${nextStepList}` +
    artifactList +
    runtime +
    `\n\nLast updated: ${task.updatedAt.slice(0, 16).replace("T", " ")} UTC`
  );
}
