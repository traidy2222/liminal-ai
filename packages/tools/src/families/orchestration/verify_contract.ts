/**
 * verify_contract — inspect the active ExecutionContract against actual progress.
 *
 * Reads the harness ExecutionState and surfaces budget consumption (steps, tool calls, minutes),
 * milestone status, and any commitment violations. Intended to be called periodically on long
 * tasks and before claiming a contract complete.
 */
import type { AgentHarness } from "@liminal/core";
import { effectiveHarnessEnvRaw, verifyToolsEnabled } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

export function createVerifyContractTool(harness: AgentHarness) {
  return defineTool({
    name: "verify_contract",
    description:
      "WHAT: Inspect the active ExecutionContract — check budget consumption, milestone status, and commitment integrity.\n" +
      "WHEN: Only when user explicitly requested verification or AGENT_VERIFY_TOOLS=1.\n" +
      "NOT WHEN: No execution state has been set (new session with no plan).\n" +
      "ARGS: mark_done — if true, mark the active contract as 'verified' (use only after full success); " +
      "goal_summary — optional one-line description of what was accomplished (included in verdict).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        mark_done: {
          type: "boolean",
          description: "If true, mark the active contract status as 'verified'",
        },
        goal_summary: {
          type: "string",
          description: "Optional one-line summary of what was accomplished",
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!verifyToolsEnabled()) {
        return {
          ok: true,
          output:
            "[verify_contract skipped] Verification tools disabled — finalize your answer to the user without a contract verification pass.",
        };
      }
      const markDone = Boolean(args["mark_done"]);
      const goalSummary = (args["goal_summary"] as string | undefined) ?? "";

      const state = harness.getExecutionState();
      if (!state) {
        return {
          ok: true,
          output:
            "No ExecutionState active in this harness — verify_contract is most useful after plan() sets up milestones.",
        };
      }

      const lines: string[] = [];

      // ── Mission ────────────────────────────────────────────────────────────────
      if (state.mission) {
        lines.push(`## Mission: ${state.mission.title} [${state.mission.status}]`);
        lines.push(`Objective: ${state.mission.objective.slice(0, 200)}`);
      }

      // ── Milestones ─────────────────────────────────────────────────────────────
      if (state.milestones.length > 0) {
        lines.push(`\n## Milestones (${state.milestones.length})`);
        for (const m of state.milestones) {
          const icon =
            m.status === "done"
              ? "✓"
              : m.status === "doing"
              ? "▶"
              : m.status === "blocked"
              ? "✗"
              : "○";
          lines.push(`  ${icon} [${m.status.toUpperCase()}] ${m.title}: ${m.objective.slice(0, 120)}`);
        }
        const done = state.milestones.filter((m) => m.status === "done").length;
        const blocked = state.milestones.filter((m) => m.status === "blocked").length;
        lines.push(`  Summary: ${done}/${state.milestones.length} done, ${blocked} blocked`);
      }

      // ── Active Contract ────────────────────────────────────────────────────────
      const activeContract = state.contracts.find(
        (c) => c.id === state.activeContractId
      );

      if (activeContract) {
        lines.push(`\n## Active Contract: ${activeContract.title} [${activeContract.status}]`);
        lines.push(`Objective: ${activeContract.objective.slice(0, 200)}`);

        // Budget checks
        const nowMs = Date.now();
        const elapsedMinutes = activeContract.startedAt
          ? Math.round((nowMs - activeContract.startedAt) / 60_000)
          : null;

        const budgetLines: string[] = [];
        if (elapsedMinutes !== null) {
          const minutePct = Math.round((elapsedMinutes / activeContract.maxMinutes) * 100);
          const minuteWarn = minutePct > 80 ? " ⚠ NEAR LIMIT" : minutePct > 100 ? " ✗ EXCEEDED" : "";
          budgetLines.push(`  Time: ${elapsedMinutes}/${activeContract.maxMinutes} min (${minutePct}%)${minuteWarn}`);
        }

        // Success criteria check
        if (activeContract.successCriteria.length > 0) {
          lines.push(`\nSuccess criteria:`);
          for (const criterion of activeContract.successCriteria) {
            lines.push(`  • ${criterion.slice(0, 160)}`);
          }
        }

        if (budgetLines.length > 0) {
          lines.push(`\nBudget consumption:`);
          lines.push(...budgetLines);
        }

        // Allowed tools check
        if (activeContract.allowedTools && activeContract.allowedTools.length > 0) {
          lines.push(`\nAllowed tools: ${activeContract.allowedTools.join(", ")}`);
        }

        // Mark done if requested
        if (markDone && activeContract.status === "active") {
          activeContract.status = "verified";
          activeContract.completedAt = nowMs;
          lines.push(`\n✓ Contract marked as VERIFIED.`);
          if (goalSummary) {
            lines.push(`Accomplished: ${goalSummary.slice(0, 300)}`);
          }
        }
      } else if (state.contracts.length > 0) {
        lines.push(`\n## Contracts (no active contract)`);
        for (const c of state.contracts) {
          lines.push(`  [${c.status}] ${c.title}`);
        }
      } else {
        lines.push(`\n## No contracts registered.`);
        lines.push(`Call plan() to create milestones and contracts for this mission.`);
      }

      // ── Drift Score ────────────────────────────────────────────────────────────
      if (state.driftScore > 0) {
        const driftLabel =
          state.driftScore >= 0.7 ? "HIGH — consider replanning" :
          state.driftScore >= 0.4 ? "MEDIUM — monitor closely" : "LOW";
        lines.push(`\n## Drift Score: ${state.driftScore.toFixed(2)} (${driftLabel})`);
      }

      // ── Commitments ────────────────────────────────────────────────────────────
      const highSeverityCommitments = state.commitments.filter((c) => c.severity === "high");
      if (highSeverityCommitments.length > 0) {
        lines.push(`\n## High-severity commitments to uphold:`);
        for (const c of highSeverityCommitments) {
          lines.push(`  [${c.scope.toUpperCase()}] ${c.label}: ${c.rationale.slice(0, 120)}`);
        }
      }

      // ── Recovery log ──────────────────────────────────────────────────────────
      if (state.recoveryLog.length > 0) {
        const recent = state.recoveryLog.slice(-3);
        lines.push(`\n## Recent recovery events (last ${recent.length}):`);
        for (const r of recent) {
          lines.push(
            `  [${r.strategy}] ${r.reason.slice(0, 100)}` +
              (r.notes ? ` — ${r.notes.slice(0, 80)}` : "")
          );
        }
      }

      // ── Unresolved questions ───────────────────────────────────────────────────
      if (state.unresolvedQuestions.length > 0) {
        lines.push(`\n## Unresolved questions (${state.unresolvedQuestions.length}):`);
        for (const q of state.unresolvedQuestions.slice(0, 5)) {
          lines.push(`  ? ${q.slice(0, 120)}`);
        }
      }

      return { ok: true, output: lines.join("\n") };
    },
  });
}
