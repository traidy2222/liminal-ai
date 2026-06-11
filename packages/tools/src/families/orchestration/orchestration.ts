import OpenAI from "openai";
import type { AgentHarness, TaskOrchestrator, SubtaskResult, ToolResult } from "@liminal/core";
import {
  completeChatJson,
  getFastModelSlug,
  resolveHarnessEnvRaw,
  detectContradictions,
  effectiveHarnessEnvRaw,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { createContextTools } from "../context/context_tools.js";
import { loadRawNotes, getNoteValue } from "../memory/notes_store.js";
import { createDecomposeGoalTool } from "./decompose_goal.js";
import { createBranchExploreTool } from "./branch_explore.js";
import { createVerifyContractTool } from "./verify_contract.js";
import { createRefreshWorldContextTool } from "./refresh_world_context.js";
import { createSetPersonaTool } from "../harness_ui/set_persona.js";
import { createAppendPersonaLivingTool } from "../harness_ui/append_persona_living.js";
import { createGetRuntimeSettingsTool } from "../harness_ui/get_runtime_settings.js";
import { createSetRuntimeSettingsTool } from "../harness_ui/set_runtime_settings.js";
import { createUploadImageTool } from "../vision/upload_image.js";
import { createExtractStructuredTool } from "../harness_ui/extract_structured.js";
import { createHypothesizeTool } from "../reasoning/hypothesize.js";
import { createResearchStateTool } from "../web/research_state.js";
import type { SubagentSpawnContract } from "@liminal/core";
import { createSpeakTool } from "../audio/speak.js";
import { createAgentContextTools } from "./agent_context_tools.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Sub-agent verification (verify_result, critics) is expensive — off unless AGENT_VERIFY_TOOLS=1. */
function verificationToolsEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_VERIFY_TOOLS") !== "0";
}

const VERIFY_TOOLS_DISABLED_OUTPUT =
  "[verification disabled] AGENT_VERIFY_TOOLS=0 — do not retry. Finish with your answer to the user.";

function skipVerificationTool(): ToolResult {
  return { ok: true, output: VERIFY_TOOLS_DISABLED_OUTPUT };
}

type ContractSource = "provided" | "synthesized";

function synthesizeSpawnContract(input: {
  goal: string;
  userPrompt?: string;
  systemPrompt?: string;
  tools?: string[];
  activateTools?: string[];
  timeoutMs?: number;
  maxRounds?: number;
}): { contract: SubagentSpawnContract; source: ContractSource; taskBrief: string } {
  const objective =
    input.userPrompt?.trim() || input.goal.trim() || "Complete the requested subtask precisely.";
  const role = input.systemPrompt?.toLowerCase().includes("review")
    ? "reviewer"
    : input.systemPrompt?.toLowerCase().includes("research")
      ? "researcher"
      : input.systemPrompt?.toLowerCase().includes("summar")
        ? "summarizer"
        : "specialist_executor";
  const deliverableFormat = input.systemPrompt?.trim()
    ? "Follow system_prompt output contract exactly."
    : "Concise markdown with findings, evidence, and explicit caveats.";
  // Restrictive allowlist only from explicit `tools` — activate_tools is additive
  // provisioning, not a capability ceiling (see spawn_agent TOOL PROVISIONING).
  const allowed = input.tools?.length ? [...new Set(input.tools)] : undefined;
  return {
    source: "synthesized",
    taskBrief: objective.slice(0, 500),
    contract: {
      role,
      objective,
      deliverableFormat,
      successCriteria: [
        "Address the objective directly with no unnecessary scope expansion.",
        "Include concrete evidence or repository references for major claims.",
        "Return output formatted for parent-agent merge.",
      ],
      nonGoals: ["Do not change unrelated files or speculate beyond evidence."],
      allowedTools: allowed,
      handoffRequirements: [
        "Provide a final concise summary of what was completed.",
        "List key evidence references used to reach conclusions.",
      ],
      budget: {
        maxRounds: input.maxRounds,
        timeoutMs: input.timeoutMs,
      },
    },
  };
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

// ─── Result fusion ───────────────────────────────────────────────────────────

async function runResultFusion(
  harness: AgentHarness,
  results: SubtaskResult[]
): Promise<string | null> {
  try {
    const resultSummaries = results
      .map((r, i) => `Agent ${i + 1} (${r.taskId.slice(0, 8)}, ${r.ok ? "ok" : "failed"}):\n${r.output.slice(0, 1200)}`)
      .join("\n\n---\n\n");

    const prompt = (
      `You are a synthesis engine. Given outputs from ${results.length} parallel sub-agents, produce a structured fusion report.\n\n` +
      `AGENT OUTPUTS:\n${resultSummaries}\n\n` +
      `Return ONLY a JSON object with these exact keys:\n` +
      `{\n` +
      `  "consensus_findings": ["string — facts all agents agreed on"],\n` +
      `  "conflicts": ["string — where agents disagreed and why"],\n` +
      `  "unique_contributions": ["agentN: unique insight from that agent"],\n` +
      `  "confidence_map": {"finding": "high|med|low"},\n` +
      `  "synthesis_summary": "2-3 sentence integrated conclusion",\n` +
      `  "recommended_next_steps": ["string"]\n` +
      `}`
    );

    const fastModel = getFastModelSlug(harness.config.model);
    const client = new OpenAI({
      apiKey: harness.config.openRouterApiKey,
      baseURL: harness.config.baseURL,
    });
    const result = await completeChatJson(client, {
      model: fastModel,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 800,
      isFastModel: true,
    });

    if (!result.ok || !result.parsed) return null;

    const j = result.parsed as {
      synthesis_summary?: string;
      consensus_findings?: string[];
      conflicts?: string[];
      unique_contributions?: string[];
      confidence_map?: Record<string, string>;
      recommended_next_steps?: string[];
    };

    const lines: string[] = [];
    if (j.synthesis_summary) lines.push(`Summary: ${j.synthesis_summary}`);
    if (j.consensus_findings?.length) {
      lines.push(`Consensus: ${j.consensus_findings.slice(0, 5).map((f) => `• ${f}`).join("\n  ")}`);
    }
    if (j.conflicts?.length) {
      lines.push(`Conflicts: ${j.conflicts.slice(0, 3).map((c) => `• ${c}`).join("\n  ")}`);
    }
    if (j.unique_contributions?.length) {
      lines.push(`Unique insights: ${j.unique_contributions.slice(0, 4).map((u) => `• ${u}`).join("\n  ")}`);
    }
    if (j.recommended_next_steps?.length) {
      lines.push(`Next steps: ${j.recommended_next_steps.slice(0, 3).map((s) => `• ${s}`).join("\n  ")}`);
    }
    return lines.join("\n\n");
  } catch {
    return null; // fusion is best-effort, never blocks
  }
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
      "WHEN: Subtask is fully independent, well-defined, and benefits from parallelism.\n" +
      "NOT WHEN: Subtask needs results you haven't produced yet. NOT WHEN: Both you and the sub-agent write the same file. NOT WHEN: Task is trivial (1-2 tool calls) — just do it inline.\n" +
      "GOOD OUTPUT: A sub-agent return value you can merge; you still own integrating every part of the user's ask (R-MULTI-PART-USER).\n\n" +
      "── PROMPT DESIGN (required for quality results) ───────────────────────────\n" +
      "Always write system_prompt AND user_prompt. A bare goal= produces a cold, generic sub-agent with no role, no output contract, and no format expectations.\n\n" +
      "system_prompt — sets the sub-agent's role, constraints, and output format. Write it as if briefing a specialist:\n" +
      "  • What role is this agent playing? (research analyst, code author, critic, data extractor…)\n" +
      "  • What are the constraints? (primary sources only, no hallucination, TypeScript only…)\n" +
      "  • What must the output look like? (JSON schema, markdown sections, single verdict line…)\n" +
      "  Example: \"You are a primary-source research analyst. Only cite .gov, official org, or top-tier press sources.\n" +
      "           Output ONLY valid JSON: {summary: string, key_stats: string[], sources: string[]}.\"\n\n" +
      "user_prompt — the full detailed task message. Include: what to research/build/check, scope boundaries,\n" +
      "  required depth, any relevant context from your current work. More detail = better output.\n" +
      "  Example: \"Research Southeast Asia EV adoption 2023-2025. Cover: market size (USD), YoY growth,\n" +
      "           top 3 markets by volume, government subsidy programs active in 2024-2025, infrastructure\n" +
      "           deployment metrics. Focus on official and primary sources. Do not speculate.\"\n\n" +
      "goal — short label for orchestrator tracking only (shown in list_agents). Does NOT drive the sub-agent if user_prompt is set.\n\n" +
      "── TOOL PROVISIONING ───────────────────────────────────────────────────────\n" +
      "activate_tools: string[] — ADDITIVE. Force-activate specific tools in the child regardless of what is\n" +
      "  currently active in the parent. Use this to give sub-agents the capabilities they need:\n" +
      "    Web researcher:  activate_tools: [\"web_search\",\"web_fetch\",\"think\"]\n" +
      "    File writer:     activate_tools: [\"write_file\",\"edit_file\",\"read_file\",\"grep_file\"]\n" +
      "    Full autonomy:   activate_tools: [\"web_search\",\"web_fetch\",\"write_file\",\"edit_file\",\"run_shell\",\"think\",\"remember\"]\n" +
      "  Every registered tool name is valid. Does NOT restrict other active tools.\n\n" +
      "tools: string[] — RESTRICTIVE allowlist. Limits child to ONLY these tools. Use for critic/read-only agents.\n" +
      "  If omitted, child inherits all currently active tools plus anything in activate_tools.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "Short label for orchestrator tracking (shown in list_agents). Used as the task message only if user_prompt is omitted.",
        },
        system_prompt: {
          type: "string",
          description: "Custom system message appended after the protocol core. Sets the sub-agent's role, constraints, and output format. STRONGLY RECOMMENDED — sub-agents without this produce generic results.",
        },
        user_prompt: {
          type: "string",
          description: "Full detailed task message sent as the sub-agent's first turn. Replace goal with a proper task description here. If omitted, goal is used instead.",
        },
        task_brief: {
          type: "string",
          description: "Focused brief for child execution; used when user_prompt is omitted.",
        },
        inherit_persona: {
          type: "boolean",
          description: "If true, child inherits parent persona. Defaults to false for neutral specialist persona.",
        },
        activate_tools: {
          type: "array",
          items: { type: "string" },
          description: "Additive tool activation — force these tools active in the child regardless of parent active set. Use to give sub-agents web, shell, vault, etc. access. Example: [\"web_search\",\"web_fetch\",\"think\",\"remember\"].",
        },
        activate_families: {
          type: "array",
          items: { type: "string" },
          description:
            "Additive family activation — reliable way to provision capabilities (e.g. [\"code_intel\",\"shell\",\"web\",\"browser\"]). " +
            "Prefer this over guessing individual tool names under lazy loading.",
        },
        context_keys: {
          type: "array",
          items: { type: "string" },
          description:
            "Shared-bus keys to inject into the sub-agent (from share_agent_context). Example: [\"ctx/abc123/pricing\"].",
        },
        context_bus_prefix: {
          type: "string",
          description: "Inject all shared-bus entries whose keys start with this prefix (e.g. \"ctx/\").",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Restrictive allowlist — limits child to ONLY these tools. Use for read-only or critic agents. Omit to inherit all active tools (plus activate_tools).",
        },
        context: {
          type: "string",
          description: "Extra context injected into the sub-agent's [SUBTASK CONTEXT] block (in addition to auto-injected parent memory).",
        },
        max_rounds: {
          type: "number",
          description: "Max ReAct rounds for this sub-agent.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in ms before auto-cancellation (default: 300000).",
        },
        contract: {
          type: "string",
          description: "Optional execution contract the sub-agent must follow (scope, success criteria, rollback plan).",
        },
        spawn_contract: {
          type: "object",
          description: "Structured spawn contract specifying role/objective/deliverable/success criteria and handoff requirements.",
        },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description: "DAG: task IDs that must complete successfully before this agent starts. Use for pipeline stages where B needs A's output.",
        },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        // Inject parent's facts + entities into child context so it isn't cold-started.
        // Notes are sorted by recency (newest first) and deduplicated by normalized value.
        let memoryContext = args["context"] as string | undefined;
        try {
          const rawNotes = await loadRawNotes();

          function recencySort(entries: [string, typeof rawNotes[string]][]): [string, typeof rawNotes[string]][] {
            return entries.slice().sort((a, b) => {
              const aT = typeof a[1] === "object" && a[1] !== null ? (a[1].updatedAt ?? "") : "";
              const bT = typeof b[1] === "object" && b[1] !== null ? (b[1].updatedAt ?? "") : "";
              return bT.localeCompare(aT);
            });
          }

          function dedupeByValue(entries: [string, string][]): [string, string][] {
            const seen = new Set<string>();
            return entries.filter(([, v]) => {
              const norm = v.trim().toLowerCase().slice(0, 60);
              if (seen.has(norm)) return false;
              seen.add(norm);
              return true;
            });
          }

          const factEntries = dedupeByValue(
            recencySort(Object.entries(rawNotes).filter(([k]) => k.startsWith("fact:")))
              .slice(0, 10)
              .map(([k, v]) => [k, getNoteValue(v)] as [string, string])
          ).slice(0, 6);

          const entityEntries = dedupeByValue(
            recencySort(Object.entries(rawNotes).filter(([k]) => k.startsWith("entity:")))
              .slice(0, 8)
              .map(([k, v]) => [k, getNoteValue(v)] as [string, string])
          ).slice(0, 4);

          const facts = factEntries.map(([k, v]) => `  ${k.slice(5)}: ${v.slice(0, 80)}`).join("\n");
          const entities = entityEntries.map(([k, v]) => `  ${k.slice(7)}: ${v.slice(0, 80)}`).join("\n");
          const memBlock = [
            facts ? `[PARENT MEMORY — Facts]\n${facts}` : "",
            entities ? `[PARENT MEMORY — Entities]\n${entities}` : "",
          ].filter(Boolean).join("\n");
          if (memBlock) {
            memoryContext = memoryContext ? `${memoryContext}\n\n${memBlock}` : memBlock;
          }
        } catch {
          // Non-fatal — proceed without injecting parent memory
        }

        const contract = typeof args["contract"] === "string" ? args["contract"].trim() : "";
        const contractContext = contract
          ? `[EXECUTION CONTRACT]\n${contract.slice(0, 3000)}`
          : "";
        const mergedContext = [memoryContext, contractContext].filter(Boolean).join("\n\n");

        const systemPrompt = typeof args["system_prompt"] === "string" ? args["system_prompt"].trim() : undefined;
        const userPrompt = typeof args["user_prompt"] === "string" ? args["user_prompt"].trim() : undefined;
        const taskBrief = typeof args["task_brief"] === "string" ? args["task_brief"].trim() : undefined;
        const dependsOn = Array.isArray(args["depends_on"])
          ? (args["depends_on"] as unknown[]).map((x) => String(x)).filter(Boolean)
          : undefined;
        const activateFamilies = Array.isArray(args["activate_families"])
          ? (args["activate_families"] as unknown[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
          : undefined;
        const contextKeys = Array.isArray(args["context_keys"])
          ? (args["context_keys"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : undefined;
        const contextBusPrefix =
          typeof args["context_bus_prefix"] === "string" ? args["context_bus_prefix"].trim() : undefined;
        const providedSpawnContract = (args["spawn_contract"] as SubagentSpawnContract | undefined) ?? undefined;

        let spawnContract: SubagentSpawnContract | undefined = providedSpawnContract;
        let contractSource: ContractSource = "provided";
        if (!spawnContract) {
          const synthesized = synthesizeSpawnContract({
            goal: String(args["goal"] ?? ""),
            userPrompt,
            systemPrompt,
            tools: args["tools"] as string[] | undefined,
            activateTools: args["activate_tools"] as string[] | undefined,
            timeoutMs: args["timeout_ms"] as number | undefined,
            maxRounds: args["max_rounds"] as number | undefined,
          });
          spawnContract = synthesized.contract;
          contractSource = synthesized.source;
        }

        const effectiveTaskBrief = taskBrief || spawnContract.objective;

        // Unsafe-only rejection: reject empty objective/brief/goal even after synthesis guard.
        if (!spawnContract.objective.trim() && !effectiveTaskBrief.trim() && !String(args["goal"] ?? "").trim()) {
          return { ok: false, error: "Unsafe spawn contract: objective/task brief/goal all empty." };
        }

        // DAG pre-check: validate dependency IDs exist.
        if (dependsOn && dependsOn.length > 0) {
          for (const depId of dependsOn) {
            if (!orchestrator.get(depId)) {
              return { ok: false, error: `depends_on task "${depId}" not found in orchestrator` };
            }
          }
        }

        const { taskId, promise } = harness.forkChild({
          goal: args["goal"] as string,
          taskBrief: effectiveTaskBrief,
          inheritPersona: args["inherit_persona"] === true,
          spawnContract,
          spawnContractSource: contractSource,
          toolNames: args["tools"] as string[] | undefined,
          activateTools: args["activate_tools"] as string[] | undefined,
          activateFamilies,
          additionalContext: mergedContext || undefined,
          contextKeys,
          contextBusPrefix,
          maxRounds: args["max_rounds"] as number | undefined,
          timeoutMs: args["timeout_ms"] as number | undefined,
          systemPrompt,
          userPrompt,
          dependsOn,
        });

        void promise; // already handled by forkChild internal completion callbacks
        return {
          ok: true,
          output:
            `Sub-agent spawned: task_id="${taskId}"\n` +
            `Contract source: ${contractSource}; role=${spawnContract.role}\n` +
            `(Tool families inferred at spawn — see subtask_spawned telemetry. Use activate_families for explicit provisioning.)\n` +
            (dependsOn && dependsOn.length > 0
              ? `Depends on: [${dependsOn.join(", ")}] — will wait for completion before proceeding.\n`
              : "") +
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
      const rawBody = sections.join("\n\n---\n\n");

      // Cross-agent fact consensus: heuristic pairwise contradiction scan.
      if (results.length >= 2) {
        const conflictEvents: Array<{
          agentA: string; agentB: string; claimA: string; claimB: string; confidence: number;
        }> = [];
        for (let a = 0; a < results.length - 1; a++) {
          for (let b = a + 1; b < results.length; b++) {
            const rA = results[a]!;
            const rB = results[b]!;
            if (!rA.ok || !rB.ok) continue;
            const found = detectContradictions(
              [{ key: rA.taskId, text: rA.output }],
              [rB.output],
              { confidenceThreshold: 0.5 }
            );
            for (const c of found) {
              conflictEvents.push({
                agentA: rA.taskId,
                agentB: rB.taskId,
                claimA: c.staleClaim,
                claimB: c.freshFact,
                confidence: c.confidence,
              });
            }
          }
        }
        if (conflictEvents.length > 0) {
          harness.getEmitter().emit("consensus_conflict", {
            taskIds: results.map((r: SubtaskResult) => r.taskId),
            conflicts: conflictEvents,
          });
          const conflictBlock =
            `\n[CONSENSUS CONFLICTS DETECTED]\n` +
            conflictEvents
              .map(
                (c) =>
                  `• Agents ${c.agentA.slice(0, 8)} vs ${c.agentB.slice(0, 8)}: ` +
                  `"${c.claimA}" conflicts with "${c.claimB}" (confidence: ${(c.confidence * 100).toFixed(0)}%)`
              )
              .join("\n") +
            `\nReview these conflicts and reconcile before treating results as ground truth.`;
          sections.push(conflictBlock);
        }
      }

      // Multi-agent result fusion (AGENT_FUSION=1, ≥2 results)
      const fusionEnabled = resolveHarnessEnvRaw("AGENT_FUSION", harness.getRuntimePreferences() ?? null) === "1";
      if (fusionEnabled && results.length >= 2) {
        const fusionReport = await runResultFusion(harness, results);
        const body = fusionReport
          ? `[FUSION REPORT]\n${fusionReport}\n\n[RAW AGENT OUTPUTS]\n${rawBody}`
          : rawBody;
        if (allOk) return { ok: true as const, output: body };
        return { ok: false as const, error: body };
      }

      if (allOk) return { ok: true as const, output: rawBody };
      return { ok: false as const, error: rawBody };
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
        .filter((t: import("@liminal/core").TaskRecord) => t.parentTaskId !== undefined);

      if (tasks.length === 0) {
        return { ok: true, output: "(no sub-agents spawned yet)" };
      }

      const lines = tasks.map((t: import("@liminal/core").TaskRecord) => {
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
      "WHEN: Only when the user explicitly asked for verification (disabled by default — AGENT_VERIFY_TOOLS=0).\n" +
      "NOT WHEN: Normal task completion — reply to the user directly. NOT for sub-agents verifying their own work.\n" +
      "ARGS: goal — original task description; result — summary of what was done; tools — optional subset (default: read_file, list_dir, think — no shell so verification does not block on approvals).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Original task description" },
        result: { type: "string", description: "Summary of what was done" },
        evidence_pack: {
          type: "string",
          description:
            "Optional excerpts from read_file/web_fetch/etc. Bind critic claims to this evidence.",
        },
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
      if (!verificationToolsEnabled()) return skipVerificationTool();
      try {
        const ev = (args["evidence_pack"] as string | undefined)?.trim();
        const evBlock =
          ev && ev.length > 20
            ? `\n\nEVIDENCE PACK (ground truth excerpts — cite these, do not invent paths):\n${ev.slice(0, 12_000)}\n`
            : "";
        const { promise } = harness.forkChild({
          goal:
            `VERIFICATION TASK (Chain-of-Verification / CoVe). Verify GOAL vs CLAIMED RESULT using tools.\n\n` +
            `GOAL:\n${args["goal"] as string}\n\n` +
            `CLAIMED RESULT:\n${args["result"] as string}\n` +
            evBlock +
            `\nProcedure:\n` +
            `1) Privately enumerate checks V1–V5: goal fit, each factual claim vs evidence/files, path/command realism, missing verification steps, residual risks.\n` +
            `2) Use read_file / list_dir / think (and optional tools arg) — bind conclusions to inspected artifacts.\n` +
            `3) If this is research/news synthesis, verify timeline completeness, source spread, uncertainty/fragility callout, and unresolved items.\n` +
            `4) Summarize briefly, then output EXACTLY ONE line:\n` +
            `   "✓ VERIFIED: [evidence tied to checks]" OR\n` +
            `   "✗ ISSUES FOUND: [specific failed checks]"`,
          toolNames: (args["tools"] as string[] | undefined) ?? [
            "read_file",
            "list_dir",
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

  // ── evidence_critic / path_critic / policy_critic (CoVe-style specialized critics) ──
  const evidenceCriticTool = defineTool({
    name: "evidence_critic",
    description:
      "WHAT: Spawn a sub-agent that checks whether result_text is supported only by evidence_pack + optional file reads.\n" +
      "WHEN: Only when user explicitly requested verification (AGENT_VERIFY_TOOLS=1).\n" +
      "ARGS: result_text, evidence_pack; optional context_goal.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        result_text: { type: "string", description: "Assistant or summary text to audit" },
        evidence_pack: { type: "string", description: "Excerpts from read_file/web_fetch/etc." },
        context_goal: { type: "string", description: "Original user goal (optional)" },
      },
      required: ["result_text", "evidence_pack"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!verificationToolsEnabled()) return skipVerificationTool();
      try {
        const rt = args["result_text"] as string;
        const ev = args["evidence_pack"] as string;
        const g = (args["context_goal"] as string | undefined)?.trim() ?? "";
        const { promise } = harness.forkChild({
          goal:
            `EVIDENCE_CRITIC: Every factual claim in RESULT_TEXT must appear in or follow from EVIDENCE_PACK (or files you read now).\n` +
            (g ? `USER GOAL:\n${g}\n\n` : "") +
            `RESULT_TEXT:\n${rt.slice(0, 10_000)}\n\nEVIDENCE_PACK:\n${ev.slice(0, 12_000)}\n\n` +
            `End with exactly one line: "✓ EVIDENCE_OK: …" or "✗ EVIDENCE_ISSUES: …"`,
          toolNames: ["read_file", "list_dir", "think"],
          maxRounds: 8,
          timeoutMs: 45_000,
        });
        const r = await promise;
        return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const pathCriticTool = defineTool({
    name: "path_critic",
    description:
      "WHAT: Sub-agent checks that file paths mentioned in result_text exist under the repo (read_file/list_dir).\n" +
      "WHEN: Only when user explicitly requested verification (AGENT_VERIFY_TOOLS=1).\n" +
      "ARGS: result_text.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        result_text: { type: "string", description: "Text containing alleged paths" },
      },
      required: ["result_text"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!verificationToolsEnabled()) return skipVerificationTool();
      try {
        const rt = args["result_text"] as string;
        const { promise } = harness.forkChild({
          goal:
            `PATH_CRITIC: Extract file-like paths from RESULT_TEXT. For each, verify with read_file or list_dir.\n` +
            `RESULT_TEXT:\n${rt.slice(0, 10_000)}\n\n` +
            `End with one line: "✓ PATHS_OK: …" or "✗ PATH_ISSUES: …" listing any missing/bad paths.`,
          toolNames: ["read_file", "list_dir", "think"],
          maxRounds: 10,
          timeoutMs: 50_000,
        });
        const r = await promise;
        return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const policyCriticTool = defineTool({
    name: "policy_critic",
    description:
      "WHAT: Sub-agent checks whether result_text violates safety / policy (e.g. malware, credential theft, disallowed exfiltration).\n" +
      "WHEN: Only when user explicitly requested verification (AGENT_VERIFY_TOOLS=1).\n" +
      "ARGS: result_text; optional policy_notes.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        result_text: { type: "string" },
        policy_notes: { type: "string", description: "Extra refusal / policy lines to enforce" },
      },
      required: ["result_text"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!verificationToolsEnabled()) return skipVerificationTool();
      try {
        const rt = args["result_text"] as string;
        const pol = (args["policy_notes"] as string | undefined)?.trim() ?? "";
        const { promise } = harness.forkChild({
          goal:
            `POLICY_CRITIC: Check RESULT_TEXT against standard assistant safety (no malware, no stealing credentials, no bypassing security, no illegal instructions).\n` +
            (pol ? `EXTRA POLICY:\n${pol.slice(0, 4000)}\n\n` : "") +
            `RESULT_TEXT:\n${rt.slice(0, 10_000)}\n\n` +
            `Use think() only. End with one line: "✓ POLICY_OK: …" or "✗ POLICY_ISSUES: …"`,
          toolNames: ["think"],
          maxRounds: 4,
          timeoutMs: 30_000,
        });
        const r = await promise;
        return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // ── reflect_debate ───────────────────────────────────────────────────────────
  // Multi-Agent Reflexion (MAR): spawn 3 persona-guided critics in parallel.
  // Each analyzes from a distinct angle; parent resolves consensus.
  const reflectDebateTool = defineTool({
    name: "reflect_debate",
    description:
      "WHAT: Spawn 3 parallel persona-guided critics (correctness, security/risk, completeness) that debate the result, then return a consensus verdict.\n" +
      "WHEN: Only when user explicitly requested verification (AGENT_VERIFY_TOOLS=1).\n" +
      "NOT WHEN: Default task completion — runs 3 sub-agents and adds major latency.\n" +
      "ARGS: goal, result; optional evidence_pack (tool-output excerpts to ground critiques).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Original task description" },
        result: { type: "string", description: "Summary of what was done / produced" },
        evidence_pack: {
          type: "string",
          description: "Optional excerpts from tool outputs to ground critic claims",
        },
      },
      required: ["goal", "result"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!verificationToolsEnabled()) return skipVerificationTool();
      try {
        const goalText = args["goal"] as string;
        const resultText = args["result"] as string;
        const ev = (args["evidence_pack"] as string | undefined)?.trim() ?? "";
        const evBlock = ev.length > 20
          ? `\n\nEVIDENCE PACK:\n${ev.slice(0, 10_000)}\n`
          : "";

        const taskPrompt = (persona: string, focus: string, verdict: string) =>
          `PERSONA: ${persona}\nFOCUS: ${focus}\n\nGOAL:\n${goalText}\n\nCLAIMED RESULT:\n${resultText}${evBlock}\n\n` +
          `Use read_file / list_dir / think to ground your verdict in evidence. ` +
          `End with exactly one line: "${verdict}: [key evidence]"`;

        // Spawn all 3 critics in parallel
        const critics = await Promise.all([
          harness.forkChild({
            goal: taskPrompt(
              "Correctness Auditor",
              "Logic correctness, factual accuracy, output matches stated goal",
              "✓ CORRECT / ✗ CORRECTNESS_ISSUES"
            ),
            toolNames: ["read_file", "list_dir", "think"],
            maxRounds: 8,
            timeoutMs: 45_000,
          }),
          harness.forkChild({
            goal: taskPrompt(
              "Security & Risk Reviewer",
              "Security vulnerabilities, dangerous side effects, credential/data exposure, irreversible actions",
              "✓ SAFE / ✗ RISK_ISSUES"
            ),
            toolNames: ["read_file", "list_dir", "think"],
            maxRounds: 8,
            timeoutMs: 45_000,
          }),
          harness.forkChild({
            goal: taskPrompt(
              "Completeness Inspector",
              "Missing edge cases, incomplete implementation, unstated assumptions, coverage gaps",
              "✓ COMPLETE / ✗ COMPLETENESS_ISSUES"
            ),
            toolNames: ["read_file", "list_dir", "think"],
            maxRounds: 8,
            timeoutMs: 45_000,
          }),
        ]);

        // Collect results
        const [correctness, security, completeness] = await Promise.all(
          critics.map((c) => c.promise)
        );

        const verdicts = [
          { role: "Correctness", result: correctness! },
          { role: "Security", result: security! },
          { role: "Completeness", result: completeness! },
        ];

        const allOk = verdicts.every((v) => v.result.ok);
        const sections = verdicts
          .map((v) => `[${v.role} Critic]\n${v.result.output.slice(0, 600)}`)
          .join("\n\n---\n\n");

        const issueCount = verdicts.filter((v) => !v.result.ok || /✗/.test(v.result.output)).length;
        const consensus =
          issueCount === 0
            ? "✓ DEBATE CONSENSUS: All 3 critics passed."
            : `✗ DEBATE ISSUES: ${issueCount}/3 critics found problems — see details above.`;

        const output = `${sections}\n\n${consensus}`;
        return allOk && issueCount === 0
          ? { ok: true, output }
          : { ok: false, error: output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    child.registry.register(childTools.evidenceCriticTool);
    child.registry.register(childTools.pathCriticTool);
    child.registry.register(childTools.policyCriticTool);
    child.registry.register(childTools.reflectDebateTool);
    const childCtxTools = createAgentContextTools(child);
    child.registry.register(childCtxTools.shareAgentContextTool);
    child.registry.register(childCtxTools.readAgentContextTool);
    // Context tools — close over child's own ContextManager
    const { checkContextTool, compressContextTool } = createContextTools(child.getContext());
    child.registry.register(checkContextTool);
    child.registry.register(compressContextTool);
    child.registry.register(createRefreshWorldContextTool(child));
    child.registry.register(createSetPersonaTool(child));
    child.registry.register(createAppendPersonaLivingTool(child));
    child.registry.register(createGetRuntimeSettingsTool(child));
    child.registry.register(createSetRuntimeSettingsTool(child));
    child.registry.register(createUploadImageTool(child));
    child.registry.register(createHypothesizeTool(child));
    child.registry.register(createExtractStructuredTool(child));
    child.registry.register(createResearchStateTool(child.getResearchLedger()));
    // Upgrade V: goal decomposer, branch explorer, contract verifier — each closes over child
    child.registry.register(createDecomposeGoalTool(child));
    child.registry.register(createBranchExploreTool(child));
    child.registry.register(createVerifyContractTool(child));
    if (resolveHarnessEnvRaw("AGENT_TTS_ENABLED", child.getRuntimePreferences()) === "1") {
      child.registry.register(createSpeakTool(child));
    }
  };

  return {
    spawnAgentTool,
    waitForAgentsTool,
    cancelAgentTool,
    listAgentsTool,
    verifyResultTool,
    evidenceCriticTool,
    pathCriticTool,
    policyCriticTool,
    reflectDebateTool,
  };
}
