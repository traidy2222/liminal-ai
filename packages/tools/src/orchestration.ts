import type { AgentHarness, TaskOrchestrator, SubtaskResult } from "@dreamthedream/core";
import { defineTool } from "./helpers.js";
import { createContextTools } from "./context_tools.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Poll orchestrator until a task reaches a terminal state or times out.
 */
async function waitForTask(
  orchestrator: TaskOrchestrator,
  taskId: string,
  timeoutMs: number
): Promise<SubtaskResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = orchestrator.get(taskId);
    if (!record) {
      return { taskId, ok: false, output: `Unknown task ID: ${taskId}`, rounds: 0 };
    }
    if (record.status === "done") {
      return { taskId, ok: true, output: record.result ?? "(no output)", rounds: 0 };
    }
    if (record.status === "error") {
      return { taskId, ok: false, output: record.result ?? "(error)", rounds: 0 };
    }
    if (record.status === "cancelled") {
      return { taskId, ok: false, output: "Task was cancelled", rounds: 0 };
    }
    await sleep(200);
  }
  // Timed out — cancel the task
  orchestrator.cancel(taskId);
  return { taskId, ok: false, output: `Timed out after ${timeoutMs}ms`, rounds: 0 };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the 4 orchestration tools scoped to a specific harness.
 * Call this for both the root harness and for each child harness.
 *
 * The `onChildCreated` hook on the harness is also wired here so that
 * grandchildren automatically get orchestration tools.
 */
export function createOrchestrationTools(harness: AgentHarness) {
  const orchestrator: TaskOrchestrator = harness.orchestrator;

  // onChildCreated is set at the bottom after all tools are defined (includes verifyResultTool)

  // ── spawn_agent ─────────────────────────────────────────────────────────────
  const spawnAgentTool = defineTool({
    name: "spawn_agent",
    description:
      "WHAT: Spawn an independent sub-agent to work on a focused subtask. Returns immediately with a task_id.\n" +
      "WHEN: The subtask is fully independent (touches different files/URLs than your current work), well-defined, and benefits from running in parallel.\n" +
      "NOT WHEN: The subtask needs results from work you haven't finished yet — finish first, then spawn.\n" +
      "NOT WHEN: Both you and the subtask would write the same file — that will cause a lock conflict.\n" +
      "NOT WHEN: The task is trivial (1-2 tool calls) — just do it inline.\n" +
      "ARGS: goal — clear single-sentence task description; tools — optional array of tool names to restrict the sub-agent to; " +
      "context — optional extra context string; max_rounds — optional round limit; timeout_ms — optional ms timeout (default: 300000).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Clear, single-sentence task description" },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Restrict sub-agent to these tool names (optional; omit for all tools)",
        },
        context: {
          type: "string",
          description: "Extra context to inject into the sub-agent's system prompt",
        },
        max_rounds: {
          type: "number",
          description: "Max ReAct rounds for this sub-agent",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in ms before auto-cancellation (default: 300000)",
        },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const { taskId } = harness.forkChild({
          goal: args["goal"] as string,
          toolNames: args["tools"] as string[] | undefined,
          additionalContext: args["context"] as string | undefined,
          maxRounds: args["max_rounds"] as number | undefined,
          timeoutMs: args["timeout_ms"] as number | undefined,
        });
        return {
          ok: true,
          output:
            `Sub-agent spawned: task_id="${taskId}"\n` +
            `Call wait_for_agents({"task_ids":["${taskId}"]}) to collect results when ready.`,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // ── wait_for_agents ──────────────────────────────────────────────────────────
  const waitForAgentsTool = defineTool({
    name: "wait_for_agents",
    description:
      "WHAT: Block until all specified sub-agents complete and return their aggregated results.\n" +
      "WHEN: After spawning sub-agents, when you need their output to continue.\n" +
      "NOT WHEN: Sub-agents were just spawned and you still have independent work to do — spawn all of them first, then wait once.\n" +
      "ARGS: task_ids — array of task IDs from spawn_agent; timeout_ms — optional total wait timeout (default: 300000).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        task_ids: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs returned by spawn_agent",
        },
        timeout_ms: {
          type: "number",
          description: "Total timeout in ms (default: 300000)",
        },
      },
      required: ["task_ids"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const taskIds = args["task_ids"] as string[];
      const timeout = (args["timeout_ms"] as number | undefined) ?? 300_000;

      const results = await Promise.all(
        taskIds.map((id) => waitForTask(orchestrator, id, timeout))
      );

      const sections = results.map((r: SubtaskResult) => {
        const status = r.ok ? "✓ done" : "✗ failed";
        const preview = r.output.slice(0, 400);
        const ellipsis = r.output.length > 400 ? "…" : "";
        return `[${r.taskId.slice(0, 8)}] ${status}\n${preview}${ellipsis}`;
      });

      const allOk = results.every((r: SubtaskResult) => r.ok);
      const body = sections.join("\n\n---\n\n");
      if (allOk) return { ok: true as const, output: body };
      return { ok: false as const, error: body };
    },
  });

  // ── cancel_agent ─────────────────────────────────────────────────────────────
  const cancelAgentTool = defineTool({
    name: "cancel_agent",
    description:
      "WHAT: Cancel a running sub-agent and release its resource locks.\n" +
      "WHEN: A sub-agent is stuck, taking too long, or its goal is no longer needed.\n" +
      "NOT WHEN: The agent has already completed — cancelling a done task is a no-op.\n" +
      "ARGS: task_id — the ID returned by spawn_agent; reason — optional explanation.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to cancel" },
        reason: { type: "string", description: "Optional reason for cancellation" },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const taskId = args["task_id"] as string;
      const record = orchestrator.get(taskId);
      if (!record) {
        return { ok: false, error: `No task found with ID: ${taskId}` };
      }
      if (record.status !== "running") {
        return {
          ok: true,
          output: `Task ${taskId.slice(0, 8)} is already ${record.status} — no action taken.`,
        };
      }
      orchestrator.cancel(taskId);
      return {
        ok: true,
        output: `Cancelled task ${taskId.slice(0, 8)}${args["reason"] ? ` (reason: ${args["reason"] as string})` : ""}.`,
      };
    },
  });

  // ── list_agents ──────────────────────────────────────────────────────────────
  const listAgentsTool = defineTool({
    name: "list_agents",
    description:
      "WHAT: List all spawned sub-agents and their current status (running/done/error/cancelled).\n" +
      "WHEN: To check progress before calling wait_for_agents, or to find a task_id you forgot.\n" +
      "NOT WHEN: You already know the task IDs — call wait_for_agents directly.\n" +
      "ARGS: none.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args) => {
      const tasks = orchestrator
        .getAll()
        .filter((t: import("@dreamthedream/core").TaskRecord) => t.parentTaskId !== undefined);

      if (tasks.length === 0) {
        return { ok: true, output: "(no sub-agents spawned yet)" };
      }

      const lines = tasks.map((t: import("@dreamthedream/core").TaskRecord) => {
        const statusIcon =
          t.status === "running"
            ? "⟳"
            : t.status === "done"
            ? "✓"
            : t.status === "cancelled"
            ? "⊘"
            : "✗";
        const age = Math.round((Date.now() - t.startedAt) / 1000);
        return (
          `${statusIcon} ${t.taskId.slice(0, 8)} [depth=${t.depth}] ${t.status} ` +
          `(${age}s) — ${t.goal.slice(0, 60)}`
        );
      });

      return { ok: true, output: lines.join("\n") };
    },
  });

  // ── verify_result ────────────────────────────────────────────────────────────
  const verifyResultTool = defineTool({
    name: "verify_result",
    description:
      "WHAT: Spawn a critic sub-agent to independently verify that a task was actually completed correctly.\n" +
      "WHEN: After completing a complex multi-step task (5+ tool calls) before reporting success to the user.\n" +
      "NOT WHEN: Simple single-tool tasks — verify manually. NOT for sub-agents verifying their own work.\n" +
      "ARGS: goal — original task description; result — summary of what was done; tools — optional subset of tools for the critic.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Original task description" },
        result: { type: "string", description: "Summary of what was done" },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool subset for critic (default: read_file, list_dir, run_shell, think)",
        },
      },
      required: ["goal", "result"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const { promise } = harness.forkChild({
          goal:
            `VERIFICATION TASK: Independently verify whether this goal was achieved.\n\n` +
            `GOAL: ${args["goal"] as string}\n\n` +
            `CLAIMED RESULT: ${args["result"] as string}\n\n` +
            `Check the actual files/state/output. ` +
            `Return EXACTLY one of:\n` +
            `"✓ VERIFIED: [evidence of success]"\n` +
            `"✗ ISSUES FOUND: [specific problems]"`,
          toolNames: (args["tools"] as string[] | undefined) ?? [
            "read_file",
            "list_dir",
            "run_shell",
            "think",
          ],
          maxRounds: 10,
          timeoutMs: 60_000,
        });
        const r = await promise;
        return r.ok
          ? { ok: true, output: r.output }
          : { ok: false, error: r.output };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  // Wire onChildCreated so grandchildren get fresh harness-scoped tools
  harness.onChildCreated = (child: AgentHarness) => {
    // Orchestration tools — close over child harness
    const childTools = createOrchestrationTools(child);
    child.registry.register(childTools.spawnAgentTool);
    child.registry.register(childTools.waitForAgentsTool);
    child.registry.register(childTools.cancelAgentTool);
    child.registry.register(childTools.listAgentsTool);
    child.registry.register(childTools.verifyResultTool);
    // Context tools — close over child's own ContextManager
    const { checkContextTool, compressContextTool } = createContextTools(child.getContext());
    child.registry.register(checkContextTool);
    child.registry.register(compressContextTool);
  };

  return { spawnAgentTool, waitForAgentsTool, cancelAgentTool, listAgentsTool, verifyResultTool };
}
