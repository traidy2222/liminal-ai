/**
 * decompose_goal — break a high-level goal into a structured task DAG using the fast model.
 *
 * Returns a node list (tasks) and an edge list (dependencies), ready for use with
 * spawn_agent + depends_on for parallel sub-agent execution.
 */
import type { AgentHarness } from "@liminal/core";
import { completeChatJson } from "@liminal/core";
import OpenAI from "openai";
import { defineTool } from "./helpers.js";

interface DagNode {
  id: string;
  description: string;
  type: "sequential" | "parallel";
  /** Optional system_prompt hint for the sub-agent assigned to this node. */
  agent_role?: string;
}

interface DagEdge {
  from: string;
  to: string;
}

interface DecomposedDag {
  nodes: DagNode[];
  edges: DagEdge[];
  summary: string;
}

export function createDecomposeGoalTool(harness: AgentHarness) {
  return defineTool({
    name: "decompose_goal",
    description:
      "WHAT: Break a high-level goal into a structured task DAG (nodes + dependency edges) using the fast model.\n" +
      "WHEN: Before spawning multiple sub-agents; use this to identify which tasks can run in parallel vs. sequentially.\n" +
      "NOT WHEN: The goal is already a single well-scoped task — just call spawn_agent directly.\n" +
      "ARGS: goal — the high-level goal to decompose; " +
      "context — optional additional context about constraints or available resources; " +
      "max_nodes — max tasks to emit (default 6, max 12).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "The high-level goal to decompose into subtasks",
        },
        context: {
          type: "string",
          description: "Optional additional context: constraints, available files, prior findings",
        },
        max_nodes: {
          type: "number",
          description: "Maximum number of tasks to emit (default 6, max 12)",
          minimum: 2,
          maximum: 12,
        },
        spawn_agents: {
          type: "boolean",
          description:
            "When true, spawn a sub-agent per DAG node via spawn_agent with depends_on edges wired automatically.",
        },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const goal = args["goal"] as string;
      const context = (args["context"] as string | undefined) ?? "";
      const maxNodes = Math.min(12, Math.max(2, (args["max_nodes"] as number | undefined) ?? 6));

      const { openRouterApiKey, model, baseURL } = harness.config;
      if (!openRouterApiKey) {
        return { ok: false, error: "AGENT_API_KEY not configured — cannot call decompose model." };
      }

      const client = new OpenAI({ apiKey: openRouterApiKey, baseURL });

      const contextBlock = context.trim() ? `\nContext:\n${context.slice(0, 800)}` : "";

      const jr = await completeChatJson(client, {
        model,
        maxTokens: 900,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are a task decomposition engine. Given a goal, produce a minimal task DAG. " +
              "Return JSON only with this shape:\n" +
              '{"nodes":[{"id":"t1","description":"...","type":"parallel|sequential","agent_role":"..."}],' +
              '"edges":[{"from":"t1","to":"t2"}],"summary":"one-line overall strategy"}.\n' +
              "Rules:\n" +
              `- Emit at most ${maxNodes} nodes.\n` +
              "- Use 'parallel' for tasks that can run concurrently (no data dependency).\n" +
              "- Use 'sequential' for tasks that depend on prior output.\n" +
              "- edges represent 'from must finish before to starts'.\n" +
              "- agent_role is a one-sentence specialist description for the sub-agent (e.g. 'Read-only TypeScript analyzer').\n" +
              "- Keep descriptions concrete and actionable (≤120 chars each).\n" +
              "- Do not emit redundant or trivial tasks.",
          },
          {
            role: "user",
            content: `Goal: ${goal.slice(0, 1200)}${contextBlock}`,
          },
        ],
      });

      if (!jr.ok) {
        return {
          ok: false,
          error: `Decomposition model call failed: ${jr.error}`,
        };
      }

      const parsed = jr.parsed as Record<string, unknown>;
      const nodes = parsed["nodes"];
      const edges = parsed["edges"];
      const summary = typeof parsed["summary"] === "string" ? parsed["summary"] : "";

      if (!Array.isArray(nodes) || nodes.length === 0) {
        return {
          ok: false,
          error: `Decomposition returned no nodes. Raw: ${jr.raw.slice(0, 300)}`,
        };
      }

      const dag: DecomposedDag = {
        nodes: (nodes as DagNode[]).slice(0, maxNodes),
        edges: Array.isArray(edges) ? (edges as DagEdge[]) : [],
        summary,
      };

      const nodeLines = dag.nodes
        .map((n) => `  [${n.id}] (${n.type}) ${n.description}`)
        .join("\n");
      const edgeLines =
        dag.edges.length > 0
          ? "\nDependencies:\n" +
            dag.edges.map((e) => `  ${e.from} → ${e.to}`).join("\n")
          : "\n(No dependencies — all nodes can start in parallel)";
      const roleTip =
        "\n\nAgent roles (use as system_prompt in spawn_agent):\n" +
        dag.nodes
          .filter((n) => n.agent_role)
          .map((n) => `  [${n.id}] ${n.agent_role}`)
          .join("\n");

      let spawnSection = "";
      if (args["spawn_agents"] === true) {
        const idToTaskId = new Map<string, string>();
        const spawned: string[] = [];
        for (const node of dag.nodes) {
          const dependsOn = dag.edges
            .filter((e) => e.to === node.id)
            .map((e) => idToTaskId.get(e.from))
            .filter((x): x is string => Boolean(x));
          const { taskId } = harness.forkChild({
            goal: node.description,
            taskBrief: node.description,
            userPrompt: node.description,
            systemPrompt: node.agent_role,
            dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
            inheritPersona: false,
          });
          idToTaskId.set(node.id, taskId);
          spawned.push(taskId);
        }
        spawnSection =
          `\n\nSpawned ${spawned.length} sub-agent(s):\n` +
          spawned.map((id, i) => `  ${dag.nodes[i]?.id ?? "?"} → ${id}`).join("\n") +
          "\nCall wait_for_agents with these task_ids when ready.";
      }

      return {
        ok: true,
        output:
          `Decomposed into ${dag.nodes.length} tasks.\n` +
          (summary ? `Strategy: ${summary}\n` : "") +
          `\nTasks:\n${nodeLines}${edgeLines}${roleTip}${spawnSection}\n\n` +
          `Full DAG JSON:\n${JSON.stringify(dag, null, 2)}`,
      };
    },
  });
}
