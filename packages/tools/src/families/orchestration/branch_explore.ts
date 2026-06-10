/**
 * branch_explore — multi-path exploration via 2 read-only sub-agents with divergent approaches.
 *
 * Spawns two critic sub-agents against the same question with different exploration angles,
 * then uses a fast-model judge to pick the higher-confidence answer (or merges both).
 *
 * Use this when you're uncertain which of two architectural/research paths is better and
 * want a quick second opinion before committing to expensive tool calls.
 */
import type { AgentHarness, SubtaskResult } from "@liminal/core";
import { completeChatJson } from "@liminal/core";
import OpenAI from "openai";
import { defineTool } from "../../shared/helpers.js";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForTask(
  harness: AgentHarness,
  taskId: string,
  timeoutMs: number
): Promise<SubtaskResult> {
  const orchestrator = harness.orchestrator;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = orchestrator.get(taskId);
    if (!record) return { taskId, ok: false, output: `Unknown task: ${taskId}`, rounds: 0 };
    if (record.status === "done") return { taskId, ok: true, output: record.result ?? "", rounds: 0 };
    if (record.status === "error") return { taskId, ok: false, output: record.result ?? "(error)", rounds: 0 };
    if (record.status === "cancelled") return { taskId, ok: false, output: "cancelled", rounds: 0 };
    await sleep(300);
  }
  orchestrator.cancel(taskId);
  return { taskId, ok: false, output: `Timed out after ${timeoutMs}ms`, rounds: 0 };
}

export function createBranchExploreTool(harness: AgentHarness) {
  return defineTool({
    name: "branch_explore",
    description:
      "WHAT: Spawn two read-only sub-agents exploring the same question from divergent angles, then pick the better answer.\n" +
      "WHEN: Uncertain which of two analysis/research/design approaches is more accurate; want a second opinion fast.\n" +
      "NOT WHEN: The task is write-heavy (editing files, running shell) — branch_explore only issues read-only critic agents.\n" +
      "ARGS: question — the analytical question or hypothesis to explore; " +
      "approach_a — description of the first exploration angle; " +
      "approach_b — description of the second exploration angle; " +
      "context — optional shared context/background; " +
      "timeout_ms — per-branch timeout in ms (default 90000).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The analytical question, hypothesis, or design decision to explore",
        },
        approach_a: {
          type: "string",
          description: "First exploration angle (e.g. 'bottom-up from data sources')",
        },
        approach_b: {
          type: "string",
          description: "Second exploration angle (e.g. 'top-down from API contracts')",
        },
        context: {
          type: "string",
          description: "Shared background context or available files",
        },
        timeout_ms: {
          type: "number",
          description: "Per-branch timeout in ms (default 90000, max 300000)",
          minimum: 15000,
          maximum: 300000,
        },
      },
      required: ["question", "approach_a", "approach_b"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const question = args["question"] as string;
      const approachA = args["approach_a"] as string;
      const approachB = args["approach_b"] as string;
      const context = (args["context"] as string | undefined) ?? "";
      const timeoutMs = Math.min(
        300_000,
        Math.max(15_000, (args["timeout_ms"] as number | undefined) ?? 90_000)
      );

      const sharedContext = context.trim()
        ? `\n\nBackground context:\n${context.slice(0, 1200)}`
        : "";

      const readOnlyTools = [
        "think",
        "read_file",
        "read_file_chunked",
        "list_dir",
        "repo_map",
        "ast_grep",
        "symbol_index",
        "find_references",
        "file_metadata",
        "workspace_snapshot",
        "web_search",
        "web_fetch",
        "recall_relevant",
        "search_memory",
        "recall",
        "memory_query",
        "vault_read",
        "vault_search",
        "vault_list",
        "git_status",
        "git_diff",
        "git_log",
      ];

      const commonSystemPrompt =
        "You are a read-only analyst. Your ONLY job is to investigate and report findings — " +
        "you MUST NOT write files, run shell commands, or make any changes. " +
        "Return a structured analysis: key findings, evidence (file paths + line excerpts), " +
        "confidence (low/med/high), and a one-paragraph conclusion.";

      // Spawn both branches simultaneously
      const [spawnA, spawnB] = [
        harness.forkChild({
          goal: `[Branch A] ${question}`,
          toolNames: readOnlyTools,
          systemPrompt: commonSystemPrompt,
          userPrompt:
            `Question: ${question.slice(0, 800)}\n\n` +
            `Your exploration angle: ${approachA.slice(0, 400)}${sharedContext}`,
          timeoutMs,
        }),
        harness.forkChild({
          goal: `[Branch B] ${question}`,
          toolNames: readOnlyTools,
          systemPrompt: commonSystemPrompt,
          userPrompt:
            `Question: ${question.slice(0, 800)}\n\n` +
            `Your exploration angle: ${approachB.slice(0, 400)}${sharedContext}`,
          timeoutMs,
        }),
      ];
      const idA = spawnA.taskId;
      const idB = spawnB.taskId;

      // Wait for both branches
      const [resultA, resultB] = await Promise.all([
        waitForTask(harness, idA, timeoutMs + 5_000),
        waitForTask(harness, idB, timeoutMs + 5_000),
      ]);

      const aText = resultA.ok ? resultA.output : `[Branch A failed: ${resultA.output}]`;
      const bText = resultB.ok ? resultB.output : `[Branch B failed: ${resultB.output}]`;

      // If both failed, surface raw error
      if (!resultA.ok && !resultB.ok) {
        return {
          ok: false,
          error: `Both branches failed.\nBranch A: ${aText}\nBranch B: ${bText}`,
        };
      }

      // If only one succeeded, use it directly
      if (!resultA.ok) {
        return {
          ok: true,
          output:
            `Branch A failed; using Branch B result only.\n\n` +
            `**Branch B (${approachB}):**\n${bText}`,
        };
      }
      if (!resultB.ok) {
        return {
          ok: true,
          output:
            `Branch B failed; using Branch A result only.\n\n` +
            `**Branch A (${approachA}):**\n${aText}`,
        };
      }

      // Both succeeded — use fast model to compare and synthesize
      const { openRouterApiKey, model, baseURL } = harness.config;
      if (!openRouterApiKey) {
        // No fast model: return both results for the parent to judge
        return {
          ok: true,
          output:
            `Both branches complete. No fast model configured — returning both for you to judge.\n\n` +
            `**Branch A (${approachA}):**\n${aText.slice(0, 3000)}\n\n` +
            `**Branch B (${approachB}):**\n${bText.slice(0, 3000)}`,
        };
      }

      const client = new OpenAI({ apiKey: openRouterApiKey, baseURL });

      const jr = await completeChatJson(client, {
        model,
        maxTokens: 600,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a judge comparing two analytical reports. " +
              "Return JSON only: {winner:'A'|'B'|'both',confidence:'low'|'med'|'high'," +
              "synthesis:string,reason:string}. " +
              "winner='both' when the reports are complementary and should be merged. " +
              "synthesis: a compact merged conclusion (≤400 chars). " +
              "reason: why you picked this winner (≤200 chars).",
          },
          {
            role: "user",
            content:
              `Question: ${question.slice(0, 600)}\n\n` +
              `Branch A (angle: ${approachA.slice(0, 200)}):\n${aText.slice(0, 2000)}\n\n` +
              `Branch B (angle: ${approachB.slice(0, 200)}):\n${bText.slice(0, 2000)}`,
          },
        ],
      });

      if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
        // Fallback: return both
        return {
          ok: true,
          output:
            `Both branches complete (judge call failed — returning both).\n\n` +
            `**Branch A (${approachA}):**\n${aText.slice(0, 3000)}\n\n` +
            `**Branch B (${approachB}):**\n${bText.slice(0, 3000)}`,
        };
      }

      const p = jr.parsed as Record<string, unknown>;
      const winner = p["winner"] as string;
      const synthesis = typeof p["synthesis"] === "string" ? p["synthesis"] : "";
      const reason = typeof p["reason"] === "string" ? p["reason"] : "";
      const confidence = typeof p["confidence"] === "string" ? p["confidence"] : "med";

      const winnerOutput =
        winner === "A"
          ? aText
          : winner === "B"
          ? bText
          : `${aText.slice(0, 1500)}\n\n---\n\n${bText.slice(0, 1500)}`;

      return {
        ok: true,
        output:
          `**Branch winner: ${winner === "both" ? "Both (merged)" : `Branch ${winner}`}** (confidence: ${confidence})\n` +
          (reason ? `Reason: ${reason}\n` : "") +
          (synthesis ? `\nSynthesis: ${synthesis}\n` : "") +
          `\n---\n\n${winnerOutput}`,
      };
    },
  });
}
