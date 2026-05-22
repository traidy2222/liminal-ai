import { defineTool } from "./helpers.js";

export const reasonTool = defineTool({
  name: "reason",
  description:
    "WHAT: Lightweight inter-step inference — for interpreting a tool result and deriving what to do next. " +
    "This is the inference channel, not the planning channel. For deep planning or task orientation, use think() instead.\n" +
    "WHEN: After receiving a tool result, use reason() to: interpret what it means, connect it to the goal, " +
    "identify the logical next action, or flag a contradiction. Examples: " +
    "'the search returned no results → the term may be wrong, try a different query'; " +
    "'the file exists at path X → read it before editing'; " +
    "'the build failed with error Y → the cause is Z, fix by doing W'.\n" +
    "NOT WHEN: Before starting a task (use think()), or for trivial single-step actions where the next step is obvious, " +
    "or when [REASONING BUDGET] says think=skip.\n" +
    "KEEP IT SHORT: reason() should be 1-3 sentences. It is a micro-inference step, not an essay. " +
    "If you need more space, you need think() instead.\n" +
    "ARGS: inference (required — the logical step being drawn, 1-3 sentences); " +
    "confidence (low|medium|high — how certain you are); " +
    "next_action (optional — the specific tool call or action this inference leads to).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      inference: {
        type: "string",
        description: "The logical step being drawn from the current context — 1-3 sentences max",
        minLength: 1,
        maxLength: 600,
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How confident you are in this inference",
      },
      next_action: {
        type: "string",
        description: "The specific tool call or action this inference leads to (optional)",
        maxLength: 200,
      },
    },
    required: ["inference"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const confidence = args["confidence"] as string | undefined;
    const nextAction = args["next_action"] as string | undefined;
    const parts: string[] = [];
    if (confidence) parts.push(`confidence:${confidence}`);
    if (nextAction) parts.push(`next:${nextAction}`);
    return { ok: true as const, output: parts.length ? `✓ [${parts.join(" | ")}]` : "✓" };
  },
});
