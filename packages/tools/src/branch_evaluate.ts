/**
 * branch_evaluate — hypothesis tournament via parallel sub-agents.
 *
 * Accepts N competing approach branches, spawns one read-only evaluator sub-agent
 * per branch in parallel, collects structured evaluation outputs, scores them
 * against explicit criteria, and returns a ranked summary with the winner.
 *
 * Each evaluator gets: its branch description, the evaluation criteria, and
 * read-only tools (no writes/shell/git commits). Max 5 branches, 4-minute timeout.
 *
 * Gate: requires harness (orchestration tools must be available).
 */

import type { AgentHarness, SubtaskResult } from "@liminal/core";
import { defineTool } from "./helpers.js";

interface BranchInput {
  id: string;
  label: string;
  description: string;
  hypothesis?: string;
}

interface EvaluationCriteria {
  criterion: string;
  weight?: number; // 1–5, default 3
}

interface BranchScore {
  branchId: string;
  label: string;
  totalScore: number;
  criteriaScores: Record<string, number>;
  evidence: string;
  output: string;
  taskId: string;
}

const READ_ONLY_TOOLS = [
  "read_file", "read_file_chunked", "list_dir", "repo_map", "grep_file",
  "git_status", "git_diff", "git_log", "web_fetch", "web_search",
  "think", "recall_relevant", "search_memory", "memory_query",
  "symbol_index", "find_references", "ast_grep", "file_metadata",
];

function buildEvaluatorPrompt(
  branch: BranchInput,
  criteria: EvaluationCriteria[],
  context: string
): string {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c.criterion} (weight: ${c.weight ?? 3}/5)`)
    .join("\n");

  return (
    `You are a focused evaluator for branch approach: "${branch.label}".\n\n` +
    `APPROACH DESCRIPTION:\n${branch.description}\n\n` +
    (branch.hypothesis ? `HYPOTHESIS: ${branch.hypothesis}\n\n` : "") +
    (context ? `CONTEXT:\n${context}\n\n` : "") +
    `EVALUATION CRITERIA:\n${criteriaList}\n\n` +
    `TASK:\n` +
    `1. Investigate this approach using available read-only tools.\n` +
    `2. For each criterion, assign a score 0-10 and provide 1-2 lines of evidence.\n` +
    `3. Return a JSON block in this exact format:\n` +
    "```json\n" +
    `{\n` +
    `  "criteria_scores": { "criterion_text": score_number },\n` +
    `  "overall_assessment": "2-3 sentence summary",\n` +
    `  "key_evidence": "most compelling piece of evidence found",\n` +
    `  "risks": "main risk or concern with this approach",\n` +
    `  "recommendation": "proceed" | "caution" | "reject"\n` +
    `}\n` +
    "```\n" +
    `Do not write any files. Stay strictly within this branch evaluation.`
  );
}

function parseEvaluatorOutput(output: string): {
  criteriaScores: Record<string, number>;
  evidence: string;
  recommendation: string;
} | null {
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch?.[1]) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]) as {
      criteria_scores?: Record<string, number>;
      key_evidence?: string;
      overall_assessment?: string;
      recommendation?: string;
    };
    return {
      criteriaScores: parsed.criteria_scores ?? {},
      evidence: parsed.key_evidence ?? parsed.overall_assessment ?? output.slice(0, 200),
      recommendation: parsed.recommendation ?? "caution",
    };
  } catch {
    return null;
  }
}

function scoreBranch(
  parsed: ReturnType<typeof parseEvaluatorOutput>,
  criteria: EvaluationCriteria[]
): number {
  if (!parsed) return 0;
  let total = 0;
  let weightSum = 0;
  for (const c of criteria) {
    const weight = c.weight ?? 3;
    const score = parsed.criteriaScores[c.criterion] ?? 5; // default neutral
    total += score * weight;
    weightSum += weight * 10; // max per criterion
  }
  return weightSum > 0 ? total / weightSum : 0;
}

export function createBranchEvaluateTool(harness: AgentHarness) {
  return defineTool({
    name: "branch_evaluate",
    description:
      "Evaluate N competing approach branches in parallel using read-only sub-agents. " +
      "Returns ranked results with the winning branch and evidence. " +
      "Ideal for architectural decisions, implementation strategy selection, or hypothesis testing. " +
      "Each branch gets its own isolated evaluator with access to read-only tools.",
    parameters: {
      type: "object",
      properties: {
        branches: {
          type: "array",
          description: "Array of 2–5 approach branches to evaluate in parallel.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short unique identifier (e.g. 'A', 'B', 'approach_1')." },
              label: { type: "string", description: "Human-readable label for this approach." },
              description: { type: "string", description: "Full description of the approach to evaluate." },
              hypothesis: { type: "string", description: "Optional hypothesis to test." },
            },
            required: ["id", "label", "description"],
          },
        },
        criteria: {
          type: "array",
          description: "Evaluation criteria. Each evaluator scores each criterion 0–10.",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string", description: "Criterion description (e.g. 'Implementation complexity')." },
              weight: { type: "number", description: "Importance weight 1–5 (default 3).", minimum: 1, maximum: 5 },
            },
            required: ["criterion"],
          },
        },
        context: {
          type: "string",
          description: "Optional shared context provided to all evaluators (codebase info, constraints, etc.).",
          maxLength: 2000,
        },
        timeout_ms: {
          type: "number",
          description: "Timeout per branch evaluator in ms (default 180000, max 300000).",
          minimum: 30000,
          maximum: 300000,
        },
      },
      required: ["branches", "criteria"],
    },
    requiresApproval: false,
    cacheable: false,
    handler: async (args, emit) => {
      const branches = args["branches"] as BranchInput[];
      const criteria = args["criteria"] as EvaluationCriteria[];
      const context = String(args["context"] ?? "");
      const timeoutMs = Math.min(300000, Math.max(30000, Number(args["timeout_ms"] ?? 180000)));

      if (!Array.isArray(branches) || branches.length < 2) {
        return { ok: false, error: "branches must be an array of at least 2 items" };
      }
      if (branches.length > 5) {
        return { ok: false, error: "branch_evaluate supports at most 5 branches" };
      }
      if (!Array.isArray(criteria) || criteria.length === 0) {
        return { ok: false, error: "criteria must be a non-empty array" };
      }

      emit?.(`[branch_evaluate] Starting ${branches.length} parallel evaluators…\n`);

      // Spawn all evaluators in parallel
      const spawnResults = await Promise.all(
        branches.map(async (branch) => {
          const systemPrompt =
            `You are a neutral branch evaluator. Evaluate the given approach strictly and honestly. ` +
            `Use only read-only tools. Return structured JSON as instructed. Do not deviate.`;
          const userPrompt = buildEvaluatorPrompt(branch, criteria, context);

          try {
            const child = harness.forkChild({
              goal: `Evaluate branch: ${branch.label}`,
              toolNames: READ_ONLY_TOOLS,
              systemPrompt,
              userPrompt,
              maxRounds: 12,
              timeoutMs,
              inheritPersona: false,
            });
            return { branch, child, taskId: child.taskId };
          } catch (err) {
            return { branch, child: null, taskId: null, error: String(err) };
          }
        })
      );

      // Wait for all children to complete
      const taskIds = spawnResults
        .filter((r): r is typeof r & { taskId: string } => r.taskId !== null)
        .map((r) => r.taskId);

      const results = new Map<string, SubtaskResult>();
      if (taskIds.length > 0) {
        const waited = await harness.waitForChildren(taskIds, timeoutMs + 10000);
        for (const r of waited) results.set(r.taskId, r);
      }

      // Score all branches
      const scores: BranchScore[] = [];
      for (const { branch, taskId, child } of spawnResults) {
        const result = taskId ? results.get(taskId) : null;
        const output = result?.output ?? (child === null ? "Evaluator failed to spawn" : "No output");
        const parsed = parseEvaluatorOutput(output);
        const totalScore = scoreBranch(parsed, criteria);

        scores.push({
          branchId: branch.id,
          label: branch.label,
          totalScore,
          criteriaScores: parsed?.criteriaScores ?? {},
          evidence: parsed?.evidence ?? "(parse failed)",
          output: output.slice(0, 800),
          taskId: taskId ?? "n/a",
        });
      }

      // Sort by score descending
      scores.sort((a, b) => b.totalScore - a.totalScore);
      const winner = scores[0]!;

      const lines: string[] = [
        `[BRANCH EVALUATION COMPLETE — ${branches.length} branches, ${criteria.length} criteria]`,
        "",
        `WINNER: ${winner.label} (id=${winner.branchId}) — score ${(winner.totalScore * 100).toFixed(0)}%`,
        `Evidence: ${winner.evidence}`,
        "",
        "RANKINGS:",
      ];

      for (let i = 0; i < scores.length; i++) {
        const s = scores[i]!;
        lines.push(
          `  ${i + 1}. ${s.label} — ${(s.totalScore * 100).toFixed(0)}% ` +
          `(${s.branchId}) taskId=${s.taskId}`
        );
        lines.push(`     Evidence: ${s.evidence.slice(0, 120)}`);
      }

      lines.push("");
      lines.push("DETAILED RESULTS:");
      for (const s of scores) {
        lines.push(`\n--- Branch: ${s.label} (${s.branchId}) ---`);
        lines.push(s.output.slice(0, 600) + (s.output.length > 600 ? "…" : ""));
      }

      return { ok: true, output: lines.join("\n") };
    },
  });
}
