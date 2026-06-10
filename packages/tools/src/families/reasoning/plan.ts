import { defineTool } from "../../shared/helpers.js";

/**
 * Structured plan() with machine-trackable step progress.
 * (#8 — AgentProp-Bench arXiv:2604.16706)
 *
 * Two call modes:
 *   plan({ steps: ["step 1", "step 2", ...] })  — create a new plan
 *   plan({ step_index: 0 })                       — mark step 0 as complete
 *
 * The UI (useAgent.ts) intercepts the tool_result and:
 *   - On steps[]: creates a new plan card
 *   - On step_index: finds the last plan card and prefixes the step with ✓
 */
export const planTool = defineTool({
  name: "plan",
  description:
    "WHAT: Emit a numbered execution plan before starting a multi-step task. " +
    "Call with step_index to mark a step done as you complete each one.\n" +
    "WHEN: Task requires 3+ distinct tool calls. Re-call with step_index after each step.\n" +
    "NOT WHEN: Re-planning from scratch — use steps[] again to replace the plan.\n" +
    "COVERAGE: When the user message has several requirements, mirror them as separate steps so none are dropped (R-MULTI-PART-USER).\n" +
    "ARGS: steps — ordered array of step descriptions (provide when creating a new plan); " +
    "step_index — 0-based index of the step just completed (provide to mark progress).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: { type: "string" },
        description: "Ordered list of steps to execute — provide when creating a new plan",
      },
      step_index: {
        type: "number",
        minimum: 0,
        description: "0-based index of the step just completed — provide to mark progress",
      },
      mission_title: {
        type: "string",
        description: "Optional long-horizon mission title",
      },
      milestones: {
        type: "array",
        items: { type: "string" },
        description: "Optional milestone list for long-horizon planning",
      },
      contract: {
        type: "object",
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          success_criteria: { type: "array", items: { type: "string" } },
          max_steps: { type: "number" },
          max_minutes: { type: "number" },
          max_tool_calls: { type: "number" },
        },
        description: "Optional bounded execution contract metadata",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const steps = args["steps"] as string[] | undefined;
    const stepIndex = args["step_index"] as number | undefined;

    if (steps && steps.length > 0) {
      const milestones = Array.isArray(args["milestones"]) ? (args["milestones"] as string[]) : [];
      const missionTitle = typeof args["mission_title"] === "string" ? args["mission_title"] : "";
      const contract = args["contract"] as
        | {
            title?: string;
            objective?: string;
            success_criteria?: string[];
            max_steps?: number;
            max_minutes?: number;
            max_tool_calls?: number;
          }
        | undefined;
      return {
        ok: true as const,
        output:
          `Plan recorded: ${steps.length} step(s).\n` +
          (missionTitle ? `Mission: ${missionTitle}\n` : "") +
          (milestones.length > 0
            ? `Milestones:\n${milestones.map((m, i) => `  M${i + 1}. ${m}`).join("\n")}\n`
            : "") +
          (contract
            ? `Contract: ${contract.title ?? "untitled"} | max_steps=${contract.max_steps ?? "n/a"} max_minutes=${contract.max_minutes ?? "n/a"} max_tool_calls=${contract.max_tool_calls ?? "n/a"}\n`
            : "") +
          steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n"),
      };
    }

    if (stepIndex !== undefined) {
      return {
        ok: true as const,
        output: `Step ${stepIndex} marked complete.`,
      };
    }

    return {
      ok: false as const,
      error: "Provide steps[] to create a plan or step_index to mark a step done.",
    };
  },
});
